use mailparse::{addrparse_header, MailAddr, MailHeader, MailHeaderMap};
use rusqlite::{params, OptionalExtension};

pub(crate) struct ParticipantHeader {
    pub(crate) kind: &'static str,
    pub(crate) addresses: Vec<(Option<String>, String)>,
}

pub(crate) fn parse_participant_headers(headers: &[MailHeader<'_>]) -> Vec<ParticipantHeader> {
    [
        ("From", "from"),
        ("Sender", "sender"),
        ("To", "to"),
        ("Cc", "cc"),
        ("Bcc", "bcc"),
        ("Reply-To", "reply_to"),
    ]
    .into_iter()
    .map(|(name, kind)| {
        let mut addresses = Vec::new();
        for header in headers.get_all_headers(name) {
            if let Ok(parsed) = addrparse_header(header) {
                for address in parsed.iter() {
                    let singles = match address {
                        MailAddr::Single(single) => std::slice::from_ref(single),
                        MailAddr::Group(group) => group.addrs.as_slice(),
                    };
                    for single in singles {
                        let email = single.addr.trim().replace('\0', "");
                        if !email.is_empty() {
                            addresses.push((single.display_name.clone(), email));
                        }
                    }
                }
            }
        }
        ParticipantHeader { kind, addresses }
    })
    .collect()
}

pub(crate) fn participants_need_repair(
    connection: &rusqlite::Connection,
    message_id: i64,
) -> Result<bool, String> {
    let stored = connection
        .query_row(
            "SELECT raw_headers,EXISTS(SELECT 1 FROM onemail_message_addresses a
           WHERE a.message_id=m.message_id AND a.kind='from')
         FROM onemail_mail_messages m WHERE m.message_id=?1",
            [message_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, bool>(1)?)),
        )
        .optional()
        .map_err(|error| format!("读取邮件参与者状态失败：{error}"))?;
    let Some((raw_headers, has_from)) = stored else {
        return Ok(false);
    };
    if has_from {
        return Ok(false);
    }
    if let Some(raw_headers) = raw_headers {
        if let Ok((headers, _)) = mailparse::parse_headers(raw_headers.as_bytes()) {
            persist_participants(connection, message_id, &parse_participant_headers(&headers))?;
            // A successfully parsed header cache also covers messages with no address headers.
            return Ok(false);
        }
    }
    Ok(true)
}

pub(crate) fn persist_participants(
    connection: &rusqlite::Connection,
    message_id: i64,
    participants: &[ParticipantHeader],
) -> Result<(), String> {
    if participants.is_empty() {
        return Ok(());
    }
    connection
        .execute_batch("SAVEPOINT message_participants")
        .map_err(|error| format!("开始保存邮件参与者失败：{error}"))?;
    let result = (|| -> rusqlite::Result<()> {
        for header in participants {
            connection.execute(
                "DELETE FROM onemail_message_addresses WHERE message_id=?1 AND kind=?2",
                params![message_id, header.kind],
            )?;
            let mut seen = std::collections::HashSet::new();
            for (name, email) in &header.addresses {
                let email = email.trim();
                let normalized = email.to_lowercase();
                if normalized.is_empty() || !seen.insert(normalized.clone()) {
                    continue;
                }
                connection.execute(
                    "INSERT INTO onemail_message_addresses
                       (message_id,kind,name,email,normalized_email,sort_order)
                     VALUES (?1,?2,?3,?4,?5,?6)",
                    params![
                        message_id,
                        header.kind,
                        name,
                        email,
                        normalized,
                        seen.len() as i64 - 1
                    ],
                )?;
            }
        }
        Ok(())
    })();
    if let Err(error) = result {
        let _ = connection
            .execute_batch("ROLLBACK TO message_participants; RELEASE message_participants");
        return Err(format!("保存邮件参与者失败：{error}"));
    }
    connection
        .execute_batch("RELEASE message_participants")
        .map_err(|error| format!("提交邮件参与者失败：{error}"))
}

pub(crate) fn first_header_address(
    headers: &[MailHeader<'_>],
    header_name: &str,
) -> (Option<String>, Option<String>) {
    let Some(header) = headers.get_first_header(header_name) else {
        return (None, None);
    };
    if let Ok(addresses) = addrparse_header(header) {
        for address in addresses.iter() {
            let address = match address {
                MailAddr::Single(address) => Some(address),
                MailAddr::Group(group) => group.addrs.first(),
            };
            if let Some(address) = address {
                let name = address
                    .display_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_string);
                let email = address.addr.trim().to_string();
                if !email.is_empty() {
                    return (name, Some(email));
                }
            }
        }
    }
    parse_loose_address(&header.get_value())
}

fn parse_loose_address(value: &str) -> (Option<String>, Option<String>) {
    let value = value.trim();
    let (name, email) = if let Some(start) = value.rfind('<') {
        let Some(end) = value[start + 1..].find('>').map(|end| end + start + 1) else {
            return (None, None);
        };
        (
            value[..start].trim().trim_matches('"').trim().to_string(),
            value[start + 1..end].trim().to_string(),
        )
    } else {
        (String::new(), value.to_string())
    };
    if !email.contains('@') {
        return (None, None);
    }
    ((!name.is_empty()).then_some(name), Some(email))
}
