use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio::time::Duration;

pub(crate) enum WsEvent {
    Keystroke { app: String },
    Click { app: String, button: u8 },
    TypingStart,
    TypingStop,
}

pub(crate) async fn ws_loop(mut rx: mpsc::UnboundedReceiver<WsEvent>, url: String) {
    use tokio_tungstenite::tungstenite::Message;
    let mut pending: Option<serde_json::Value> = None;
    let mut retry_delay = Duration::from_secs(2);
    const MAX_RETRY_DELAY: Duration = Duration::from_secs(300);

    loop {
        let Ok((ws, _)) = tokio_tungstenite::connect_async(&url).await else {
            tokio::time::sleep(retry_delay).await;
            retry_delay = (retry_delay * 2).min(MAX_RETRY_DELAY);
            continue;
        };
        retry_delay = Duration::from_secs(2);
        let (mut write, mut read) = ws.split();

        // Retry the message that failed on the previous connection before
        // reading new events from the channel.
        if let Some(payload) = pending.take() {
            if write
                .send(Message::Text(payload.to_string()))
                .await
                .is_err()
            {
                pending = Some(payload);
                continue;
            }
        }

        loop {
            tokio::select! {
                event = rx.recv() => {
                    match event {
                        Some(event) => {
                            let payload = match event {
                                WsEvent::Keystroke { app } => {
                                    serde_json::json!({ "type": "keystroke", "app": app })
                                }
                                WsEvent::Click { app, button } => {
                                    let click_type =
                                        if button == 0 { "left_click" } else { "right_click" };
                                    serde_json::json!({ "type": click_type, "app": app })
                                }
                                WsEvent::TypingStart => {
                                    serde_json::json!({ "type": "typing_start" })
                                }
                                WsEvent::TypingStop => {
                                    serde_json::json!({ "type": "typing_stop" })
                                }
                            };
                            if write
                                .send(Message::Text(payload.to_string()))
                                .await
                                .is_err()
                            {
                                pending = Some(payload);
                                break;
                            }
                        }
                        None => return,
                    }
                }
                // Detect server-initiated close or connection reset via the read
                // half — a write-only loop would never see a graceful FIN until
                // the next send attempt, causing a stale connection to linger.
                _ = read.next() => break,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::StreamExt;
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    fn parse_ws_msg(msg: &tokio_tungstenite::tungstenite::Message) -> serde_json::Value {
        serde_json::from_str(msg.to_text().unwrap()).unwrap()
    }

    #[tokio::test]
    async fn ws_connects_and_delivers_keystroke_event() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let (tx, rx) = mpsc::unbounded_channel::<WsEvent>();
        tokio::spawn(ws_loop(rx, format!("ws://127.0.0.1:{port}")));

        let (stream, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut ws = accept_async(stream).await.unwrap();

        tx.send(WsEvent::Keystroke {
            app: "Xcode".into(),
        })
        .unwrap();

        let msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();

        let val = parse_ws_msg(&msg);
        assert_eq!(val["type"], "keystroke");
        assert_eq!(val["app"], "Xcode");
    }

    #[tokio::test]
    async fn ws_delivers_typing_start_and_stop_events() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let (tx, rx) = mpsc::unbounded_channel::<WsEvent>();
        tokio::spawn(ws_loop(rx, format!("ws://127.0.0.1:{port}")));

        let (stream, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut ws = accept_async(stream).await.unwrap();

        tx.send(WsEvent::TypingStart).unwrap();
        tx.send(WsEvent::TypingStop).unwrap();

        let start_msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(parse_ws_msg(&start_msg)["type"], "typing_start");

        let stop_msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(parse_ws_msg(&stop_msg)["type"], "typing_stop");
    }

    #[tokio::test]
    async fn ws_reconnects_after_server_closes_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let (tx, rx) = mpsc::unbounded_channel::<WsEvent>();
        tokio::spawn(ws_loop(rx, format!("ws://127.0.0.1:{port}")));

        // First connection
        let (s1, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut ws1 = accept_async(s1).await.unwrap();

        tx.send(WsEvent::Keystroke {
            app: "Terminal".into(),
        })
        .unwrap();
        let msg1 = tokio::time::timeout(Duration::from_secs(2), ws1.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(parse_ws_msg(&msg1)["type"], "keystroke");

        // Drop the server side. ws_loop's select! is also polling read.next(),
        // so it detects the TCP FIN immediately — no sleep needed.
        drop(ws1);

        // listener.accept() acts as the synchronization point: it only returns
        // once ws_loop has actually reconnected, so any events we send after
        // this point are guaranteed to land on the new connection.
        let (s2, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut ws2 = accept_async(s2).await.unwrap();

        tx.send(WsEvent::Keystroke {
            app: "Terminal".into(),
        })
        .unwrap();
        tx.send(WsEvent::Keystroke {
            app: "Terminal".into(),
        })
        .unwrap();

        let msg2 = tokio::time::timeout(Duration::from_secs(2), ws2.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(parse_ws_msg(&msg2)["type"], "keystroke");

        let msg3 = tokio::time::timeout(Duration::from_secs(2), ws2.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(parse_ws_msg(&msg3)["type"], "keystroke");
    }

    #[tokio::test]
    async fn ws_delivers_left_and_right_click_events() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();

        let (tx, rx) = mpsc::unbounded_channel::<WsEvent>();
        tokio::spawn(ws_loop(rx, format!("ws://127.0.0.1:{port}")));

        let (stream, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut ws = accept_async(stream).await.unwrap();

        tx.send(WsEvent::Click {
            app: "Finder".into(),
            button: 0,
        })
        .unwrap();
        tx.send(WsEvent::Click {
            app: "Safari".into(),
            button: 1,
        })
        .unwrap();

        let left_msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let left = parse_ws_msg(&left_msg);
        assert_eq!(left["type"], "left_click");
        assert_eq!(left["app"], "Finder");

        let right_msg = tokio::time::timeout(Duration::from_secs(2), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let right = parse_ws_msg(&right_msg);
        assert_eq!(right["type"], "right_click");
        assert_eq!(right["app"], "Safari");
    }
}
