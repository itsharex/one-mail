use async_imap::types::NameAttribute;
use base64::Engine;

pub(super) fn name_attribute_value(attribute: &NameAttribute<'_>) -> String {
    match attribute {
        NameAttribute::NoInferiors => "\\Noinferiors".to_string(),
        NameAttribute::NoSelect => "\\Noselect".to_string(),
        NameAttribute::Marked => "\\Marked".to_string(),
        NameAttribute::Unmarked => "\\Unmarked".to_string(),
        NameAttribute::All => "\\All".to_string(),
        NameAttribute::Archive => "\\Archive".to_string(),
        NameAttribute::Drafts => "\\Drafts".to_string(),
        NameAttribute::Flagged => "\\Flagged".to_string(),
        NameAttribute::Junk => "\\Junk".to_string(),
        NameAttribute::Sent => "\\Sent".to_string(),
        NameAttribute::Trash => "\\Trash".to_string(),
        NameAttribute::Extension(value) => value.to_string(),
        _ => format!("{attribute:?}"),
    }
}

pub fn is_folder_selectable(attributes: &[String]) -> bool {
    !attributes.iter().any(|attribute| {
        attribute.eq_ignore_ascii_case("\\Noselect")
            || attribute.eq_ignore_ascii_case("\\NonExistent")
    })
}

pub fn folder_role(path: &str, attributes: &[String]) -> &'static str {
    if path.eq_ignore_ascii_case("INBOX") {
        return "inbox";
    }
    for (attribute, role) in [
        ("\\Sent", "sent"),
        ("\\Drafts", "drafts"),
        ("\\Trash", "trash"),
        ("\\Junk", "junk"),
        ("\\Archive", "archive"),
        ("\\All", "all_mail"),
        ("\\Important", "important"),
        ("\\Flagged", "starred"),
    ] {
        if attributes
            .iter()
            .any(|value| value.eq_ignore_ascii_case(attribute))
        {
            return role;
        }
    }
    "custom"
}

pub fn decode_modified_utf7(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = String::with_capacity(value.len());
    let mut cursor = 0;

    while cursor < bytes.len() {
        let Some(relative_start) = bytes[cursor..].iter().position(|byte| *byte == b'&') else {
            decoded.push_str(&value[cursor..]);
            break;
        };
        let start = cursor + relative_start;
        decoded.push_str(&value[cursor..start]);
        let Some(relative_end) = bytes[start + 1..].iter().position(|byte| *byte == b'-') else {
            decoded.push_str(&value[start..]);
            break;
        };
        let end = start + 1 + relative_end;
        let encoded = &value[start + 1..end];
        if encoded.is_empty() {
            decoded.push('&');
        } else if let Some(segment) = decode_modified_utf7_segment(encoded) {
            decoded.push_str(&segment);
        } else {
            decoded.push_str(&value[start..=end]);
        }
        cursor = end + 1;
    }

    decoded
}

fn decode_modified_utf7_segment(value: &str) -> Option<String> {
    let mut encoded = value.replace(',', "/");
    match encoded.len() % 4 {
        0 => {}
        2 => encoded.push_str("=="),
        3 => encoded.push('='),
        _ => return None,
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    if bytes.len() % 2 != 0 {
        return None;
    }
    let utf16 = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
        .collect::<Vec<_>>();
    String::from_utf16(&utf16).ok()
}
