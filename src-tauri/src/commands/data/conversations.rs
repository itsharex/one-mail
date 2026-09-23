use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::cmp::Reverse;

use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use tauri::State;

use crate::{db, state::AppState};
use super::utils::{database_error, optional_i64, optional_string, require_object};

#[tauri::command]
pub async fn conversations_list(state: State<'_, AppState>, query: Option<Value>) -> Result<Value, String> {
    let path = state.database_path.clone();
    let object = query.as_ref().and_then(Value::as_object);
    let account_id = object.and_then(|o| optional_i64(o, "accountId"));
    let keyword = object.and_then(|o| optional_string(o, "keyword")).unwrap_or_default().to_lowercase();
    let (limit, offset) = pagination(object);
    tauri::async_runtime::spawn_blocking(move || {
        let connection = db::open_path(&path)?;
        conversation_page(&connection, account_id, &keyword, limit, offset)
    }).await.map_err(|error| format!("加载对话失败：{error}"))?
}

fn conversation_page(connection: &Connection, account_id: Option<i64>, keyword: &str, limit: usize, offset: usize) -> Result<Value, String> {
    let mut summaries = Vec::new();
    for (conversation_id, (participants, messages)) in collect_conversations(connection, account_id)? {
        let display_name = conversation_display_name(&participants);
        if !keyword.is_empty() && !display_name.to_lowercase().contains(keyword)
            && !participants.iter().any(|p| text(p, "email").contains(keyword))
            && !messages.iter().any(|m| text(m, "subject").to_lowercase().contains(keyword)
                || text(m, "snippet").to_lowercase().contains(keyword)) {
            continue;
        }
        summaries.push(conversation_summary(conversation_id, participants, messages, display_name));
    }
    summaries.sort_by_cached_key(|summary| (
        Reverse(message_timestamp(&summary["lastMessage"])),
        text(summary, "conversationId").to_owned(),
    ));
    Ok(Value::Array(summaries.into_iter().skip(offset).take(limit).collect()))
}

#[tauri::command]
pub async fn conversations_find_message(state: State<'_, AppState>, message_id: i64) -> Result<Option<Value>, String> {
    if message_id <= 0 { return Ok(None); }
    let path = state.database_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = db::open_path(&path)?;
        find_message_location(&connection, message_id)
    }).await.map_err(|error| format!("定位邮件失败：{error}"))?
}

fn find_message_location(connection: &Connection, message_id: i64) -> Result<Option<Value>, String> {
    let identity: Option<(i64, Option<String>)> = connection.query_row(
        "SELECT account_id,rfc822_message_id FROM onemail_mail_messages WHERE message_id=?1",
        [message_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(database_error)?;
    let Some((account_id, rfc_id)) = identity else { return Ok(None); };
    for (conversation_id, (participants, messages)) in collect_conversations(connection, None)? {
        if let Some(offset) = messages.iter().position(|message| {
            message["messageId"].as_i64() == Some(message_id) ||
                (rfc_id.as_deref().filter(|id| !id.is_empty()).is_some_and(|id|
                    message["messageRfc822Id"].as_str() == Some(id))
                    && message["accountId"].as_i64() == Some(account_id))
        }) {
            let display_name = conversation_display_name(&participants);
            return Ok(Some(json!({
                "conversation": conversation_summary(conversation_id, participants, messages, display_name),
                "offset": offset
            })));
        }
    }
    Ok(None)
}

fn conversation_display_name(participants: &[Value]) -> String {
    participants.iter().map(|person| {
        person["name"].as_str().filter(|name| !name.is_empty())
            .unwrap_or(person["email"].as_str().unwrap_or_default())
    }).collect::<Vec<_>>().join(", ")
}

fn conversation_summary(conversation_id: String, participants: Vec<Value>, messages: Vec<Value>, display_name: String) -> Value {
    let account_ids: BTreeSet<i64> = messages.iter().filter_map(|message| message["accountId"].as_i64()).collect();
    json!({
        "conversationId": conversation_id,
        "displayName": display_name,
        "isGroup": participants.len() > 1,
        "participants": participants,
        "lastMessage": messages.first(),
        "messageCount": messages.len(),
        "unreadCount": messages.iter().filter(|message| message["direction"] == "incoming" && message["isRead"] == false).count(),
        "accountIds": account_ids,
    })
}

#[tauri::command]
pub async fn conversations_messages(state: State<'_, AppState>, query: Value) -> Result<Value, String> {
    let object = require_object(&query)?;
    let conversation_id = optional_string(object, "conversationId").ok_or("会话 ID 无效。")?;
    let account_id = optional_i64(object, "accountId");
    let (limit, offset) = pagination(Some(object));
    let path = state.database_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = db::open_path(&path)?;
        conversation_messages_page(&connection, &conversation_id, account_id, limit, offset)
    }).await.map_err(|error| format!("加载对话消息失败：{error}"))?
}

fn conversation_messages_page(connection: &Connection, conversation_id: &str, account_id: Option<i64>, limit: usize, offset: usize) -> Result<Value, String> {
    let messages = collect_conversations(connection, account_id)?.remove(conversation_id)
        .map(|(_, messages)| messages).unwrap_or_default();
    let mut page = messages.into_iter().skip(offset).take(limit).collect::<Vec<_>>();
    for message in &mut page {
        let mut body: Option<(Option<String>, Option<String>)> = None;
        if let Some(id) = message["messageId"].as_i64() {
            body = connection.query_row(
                "SELECT body_text,body_html_sanitized FROM onemail_message_bodies WHERE message_id=?1",
                [id], |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional().map_err(database_error)?;
        }
        if body.is_none() {
            if let Some(id) = message["outboxId"].as_i64() {
                body = connection.query_row(
                    "SELECT body_text,NULL FROM onemail_outbox_messages WHERE outbox_id=?1",
                    [id], |row| Ok((row.get(0)?, row.get(1)?)),
                ).optional().map_err(database_error)?;
            }
        }
        if let Some((plain, html)) = body {
            message["bodyText"] = json!(plain);
            message["bodyHtmlSanitized"] = json!(html);
        }
    }
    Ok(Value::Array(page))
}

fn pagination(object: Option<&serde_json::Map<String, Value>>) -> (usize, usize) {
    (object.and_then(|o| optional_i64(o,"limit")).unwrap_or(50).clamp(1,200) as usize,
     object.and_then(|o| optional_i64(o,"offset")).unwrap_or(0).max(0) as usize)
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

fn normalized(email: &str) -> String { email.trim().to_lowercase() }

fn message_timestamp(message: &Value) -> Option<i64> {
    let value = text(message, "receivedAt").trim();
    chrono::DateTime::parse_from_rfc3339(value)
        .or_else(|_| chrono::DateTime::parse_from_rfc2822(value))
        .ok().map(|date| date.timestamp_millis())
}

type Conversations = BTreeMap<String, (Vec<Value>, Vec<Value>)>;

// Aggregate the complete local history before applying conversation or timeline pagination.
fn collect_conversations(connection: &Connection, account_id: Option<i64>) -> Result<Conversations, String> {
    let mut accounts = connection.prepare("SELECT email FROM onemail_mail_accounts").map_err(database_error)?;
    let own_addresses = accounts.query_map([], |row| row.get::<_, String>(0)).map_err(database_error)?
        .collect::<Result<Vec<_>,_>>().map_err(database_error)?.into_iter().map(|s| normalized(&s)).collect::<HashSet<_>>();
    let mut addresses: BTreeMap<i64, BTreeMap<String, Vec<Value>>> = BTreeMap::new();
    let mut statement = connection.prepare(
        "SELECT a.message_id,a.kind,a.name,a.email FROM onemail_message_addresses a
         JOIN onemail_mail_messages m ON m.message_id=a.message_id
         WHERE (?1 IS NULL OR m.account_id=?1) ORDER BY a.sort_order,a.address_id"
    ).map_err(database_error)?;
    let rows = statement.query_map([account_id], |row| Ok((row.get::<_,i64>(0)?, row.get::<_,String>(1)?,
        json!({"name":row.get::<_,Option<String>>(2)?,"email":row.get::<_,String>(3)?}))))
        .map_err(database_error)?;
    for row in rows {
        let (id, kind, address) = row.map_err(database_error)?;
        addresses.entry(id).or_default().entry(kind).or_default().push(address);
    }
    let mut statement = connection.prepare(
        "SELECT m.message_id,m.account_id,m.rfc822_message_id,m.in_reply_to,m.references_header,
                m.subject,m.from_name,m.from_email,COALESCE(m.received_at,m.sent_at,m.internal_date,m.created_at),
                m.snippet,m.is_read,m.has_attachments,NULL,NULL,m.body_status
         FROM onemail_mail_messages m JOIN onemail_mail_folders f ON f.folder_id=m.folder_id
         LEFT JOIN onemail_message_bodies b ON b.message_id=m.message_id
         WHERE (?1 IS NULL OR m.account_id=?1) AND m.remote_deleted=0 AND m.user_hidden=0
           AND m.user_deleted=0 AND m.is_deleted=0 AND m.is_draft=0 AND f.role NOT IN ('trash','junk','drafts')
         ORDER BY CASE WHEN b.message_id IS NOT NULL THEN 0 ELSE 1 END,
                  CASE WHEN f.role IN ('inbox','sent') THEN 0 ELSE 1 END,m.message_id DESC"
    ).map_err(database_error)?;
    let rows = statement.query_map([account_id], |row| {
        let id: i64 = row.get(0)?;
        Ok(json!({"id":format!("message:{id}"),"source":"message","messageId":id,"outboxId":null,
            "accountId":row.get::<_,i64>(1)?,"messageRfc822Id":row.get::<_,Option<String>>(2)?,
            "inReplyTo":row.get::<_,Option<String>>(3)?,"references":row.get::<_,Option<String>>(4)?,
            "subject":row.get::<_,Option<String>>(5)?,"fromName":row.get::<_,Option<String>>(6)?,
            "fromEmail":row.get::<_,Option<String>>(7)?,"receivedAt":row.get::<_,String>(8)?,
            "snippet":row.get::<_,Option<String>>(9)?,"isRead":row.get::<_,i64>(10)? != 0,
            "hasAttachments":row.get::<_,i64>(11)? != 0,"bodyText":row.get::<_,Option<String>>(12)?,
            "bodyHtmlSanitized":row.get::<_,Option<String>>(13)?,"status":row.get::<_,String>(14)?}))
    }).map_err(database_error)?;
    let mut messages = Vec::new();
    for row in rows {
        let mut message = row.map_err(database_error)?;
        let id = message["messageId"].as_i64().unwrap_or_default();
        let kinds = addresses.get(&id);
        for (kind, key) in [("to","to"),("cc","cc"),("bcc","bcc"),("reply_to","replyTo")] {
            message[key] = json!(kinds.and_then(|k| k.get(kind)).cloned().unwrap_or_default());
        }
        message["direction"] = json!(if own_addresses.contains(&normalized(text(&message,"fromEmail"))) {"outgoing"} else {"incoming"});
        messages.push(message);
    }
    let mut statement = connection.prepare(
        "SELECT o.outbox_id,o.account_id,o.rfc822_message_id,o.in_reply_to,o.references_header,o.subject,
                o.from_name,o.from_email,COALESCE(o.sent_at,o.created_at),substr(o.body_text,1,160),o.to_json,o.cc_json,o.bcc_json,
                EXISTS(SELECT 1 FROM onemail_outbox_attachments a WHERE a.outbox_id=o.outbox_id)
         FROM onemail_outbox_messages o WHERE o.status='sent' AND o.deleted_at IS NULL
           AND (?1 IS NULL OR o.account_id=?1)
           AND NOT EXISTS (SELECT 1 FROM onemail_mail_messages m WHERE m.account_id=o.account_id
               AND m.rfc822_message_id=o.rfc822_message_id AND (m.user_hidden=1 OR m.user_deleted=1))"
    ).map_err(database_error)?;
    let rows = statement.query_map([account_id], |row| {
        let id: i64 = row.get(0)?;
        let body: Option<String> = row.get(9)?;
        let parse = |index| -> rusqlite::Result<Value> {
            Ok(serde_json::from_str(&row.get::<_,String>(index)?).unwrap_or(json!([])))
        };
        Ok(json!({"id":format!("outbox:{id}"),"source":"outbox","messageId":null,"outboxId":id,
            "accountId":row.get::<_,i64>(1)?,"messageRfc822Id":row.get::<_,String>(2)?,
            "inReplyTo":row.get::<_,Option<String>>(3)?,"references":row.get::<_,Option<String>>(4)?,
            "subject":row.get::<_,Option<String>>(5)?,"fromName":row.get::<_,Option<String>>(6)?,
            "fromEmail":row.get::<_,String>(7)?,"receivedAt":row.get::<_,String>(8)?,
            "snippet":body.as_ref().map(|s| s.chars().take(160).collect::<String>()),
            "bodyText":null,"bodyHtmlSanitized":null,"to":parse(10)?,"cc":parse(11)?,"bcc":parse(12)?,
            "replyTo":[],"hasAttachments":row.get::<_,i64>(13)? != 0,
            "isRead":true,"direction":"outgoing","status":"sent"}))
    }).map_err(database_error)?;
    for row in rows { messages.push(row.map_err(database_error)?); }
    // Preserve the preferred synced copy, enriching missing recipient metadata from
    // duplicate folders or the local sent record before choosing its conversation.
    let mut unique: BTreeMap<String, Value> = BTreeMap::new();
    for message in messages {
        let rfc_id = text(&message,"messageRfc822Id").trim();
        let key = if rfc_id.is_empty() { text(&message,"id").to_string() }
            else { format!("{}:{rfc_id}",message["accountId"]) };
        if let Some(existing) = unique.get_mut(&key) {
            for role in ["to", "cc", "bcc", "replyTo"] {
                let mut merged = existing[role].as_array().cloned().unwrap_or_default();
                for address in message[role].as_array().into_iter().flatten() {
                    let email = normalized(text(address,"email"));
                    if !merged.iter().any(|a| normalized(text(a,"email")) == email) {
                        merged.push(address.clone());
                    }
                }
                existing[role] = json!(merged);
            }
            if existing["outboxId"].is_null() && !message["outboxId"].is_null() {
                existing["outboxId"] = message["outboxId"].clone();
            }
        } else {
            unique.insert(key, message);
        }
    }
    let mut conversations: Conversations = BTreeMap::new();
    for message in unique.into_values() {
        let mut participants = BTreeMap::new();
        let sender = json!({"email":message["fromEmail"],"name":message["fromName"]});
        // Bcc is private envelope metadata, never a visible conversation participant.
        for address in std::iter::once(&sender).chain(["to","cc"].into_iter()
            .flat_map(|key| message[key].as_array().into_iter().flatten())) {
            let email = normalized(text(address,"email"));
            if !email.is_empty() && !own_addresses.contains(&email) {
                participants.entry(email.clone()).or_insert_with(|| json!({"email":email,"name":address["name"].as_str()}));
            }
        }
        if participants.is_empty() { continue; }
        let emails = participants.keys().cloned().collect::<Vec<_>>();
        let conversation_id = if emails.len() == 1 { format!("person:{}",emails[0]) }
            else { format!("group:{}",json!(emails)) };
        let entry = conversations.entry(conversation_id).or_insert_with(|| (participants.into_values().collect(),Vec::new()));
        entry.1.push(message);
    }
    for (_, messages) in conversations.values_mut() {
        messages.sort_by_cached_key(|message| (
            Reverse(message_timestamp(message)),
            Reverse(text(message, "id").to_owned()),
        ));
    }
    Ok(conversations)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recent_contacts_are_sorted_before_pagination_across_received_and_sent_mail() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(include_str!("../../db/schema.sql")).unwrap();
        connection.execute_batch(
            "INSERT INTO onemail_provider_presets (provider_key,display_name,auth_type)
             VALUES ('test','Test','manual');
             INSERT INTO onemail_mail_accounts
               (account_id,provider_key,email,normalized_email,account_label,auth_type,imap_host,imap_port,imap_security)
             VALUES (1,'test','me@example.test','me@example.test','Test','manual','localhost',993,'ssl_tls');
             INSERT INTO onemail_mail_folders (folder_id,account_id,path,name,role)
             VALUES (1,1,'INBOX','Inbox','inbox');"
        ).unwrap();
        for (id, sender, date) in [
            (1, "alice@example.test", "Wed, 30 Oct 2024 10:00:00 +0800"),
            (2, "alice@example.test", "Mon, 14 Sep 2026 16:00:00 +0800"),
            (3, "charlie@example.test", "2026-09-14T09:00:00Z"),
            (4, "unknown@example.test", "invalid date"),
            (5, "eve@example.test", "2026-09-14T10:00:00+02:00"),
        ] {
            connection.execute(
                "INSERT INTO onemail_mail_messages (message_id,account_id,folder_id,uid,from_email,received_at)
                 VALUES (?1,1,1,?1,?2,?3)",
                rusqlite::params![id, sender, date],
            ).unwrap();
        }
        connection.execute(
            "INSERT INTO onemail_outbox_messages
               (account_id,compose_kind,status,rfc822_message_id,from_email,to_json,sent_at)
             VALUES (1,'new','sent','<sent-test>','me@example.test',?1,'2026-09-14T10:00:00Z')",
            [json!([{"email":"bob@example.test"}]).to_string()],
        ).unwrap();

        let first = conversation_page(&connection, None, "", 2, 0).unwrap();
        let second = conversation_page(&connection, None, "", 2, 2).unwrap();
        let last = conversation_page(&connection, None, "", 2, 4).unwrap();
        assert_eq!(first[0]["conversationId"], "person:bob@example.test");
        assert_eq!(first[0]["lastMessage"]["direction"], "outgoing");
        assert_eq!(first[1]["conversationId"], "person:charlie@example.test");
        assert_eq!(second[0]["conversationId"], "person:alice@example.test");
        assert_eq!(second[0]["lastMessage"]["messageId"], 2);
        assert_eq!(second[1]["conversationId"], "person:eve@example.test");
        assert_eq!(last[0]["conversationId"], "person:unknown@example.test");
        let conversations = collect_conversations(&connection, Some(1)).unwrap();
        let messages = &conversations["person:alice@example.test"].1;
        assert_eq!(messages[0]["messageId"], 2);
        assert_eq!(messages[1]["messageId"], 1);
        let location = find_message_location(&connection, 1).unwrap().unwrap();
        assert_eq!(location["conversation"]["conversationId"], "person:alice@example.test");
        assert_eq!(location["offset"], 1);
    }

    #[test]
    fn contact_dates_compare_instants_not_date_strings() {
        let timestamp = |date| message_timestamp(&json!({"receivedAt":date}));
        assert_eq!(timestamp("Mon, 14 Sep 2026 16:00:00 +0800"), timestamp("2026-09-14T08:00:00Z"));
        assert!(timestamp("2026-09-14T09:00:00Z") > timestamp("2026-09-14T16:00:00+08:00"));
        assert!(timestamp("2026-09-14T08:00:00.500Z") > timestamp("2026-09-14T08:00:00Z"));
        assert_eq!(timestamp("invalid date"), None);
    }
}
