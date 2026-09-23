use regex::Regex;

pub(super) fn normalize_body_text(value: &str) -> String {
    value
        .replace('\0', "")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

pub(super) fn sanitize_html(value: &str) -> Option<String> {
    let mut sanitized = Regex::new(r"(?is)<script[^>]*>.*?</script>")
        .expect("valid script regex")
        .replace_all(value, "")
        .into_owned();
    sanitized = Regex::new(r"(?is)<style[^>]*>.*?</style>")
        .expect("valid style regex")
        .replace_all(&sanitized, "")
        .into_owned();
    sanitized = Regex::new(r#"(?i)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)"#)
        .expect("valid event regex")
        .replace_all(&sanitized, "")
        .into_owned();
    sanitized = Regex::new(r#"(?i)\s+(src|href)\s*=\s*"javascript:[^"]*""#)
        .expect("valid javascript regex")
        .replace_all(&sanitized, "")
        .into_owned();
    sanitized = Regex::new(r#"(?i)\s+src="((?:https?:)?//[^"\s>]+)""#)
        .expect("valid remote source regex")
        .replace_all(&sanitized, r#" data-blocked-src="$1""#)
        .into_owned();
    sanitized = Regex::new(r"(?i)\s+src='((?:https?:)?//[^'\s>]+)'")
        .expect("valid remote source regex")
        .replace_all(&sanitized, " data-blocked-src='$1'")
        .into_owned();
    let sanitized = sanitized.trim().to_string();
    (!sanitized.is_empty()).then_some(sanitized)
}

pub(crate) fn html_to_text(value: &str) -> String {
    Regex::new(r"(?is)<[^>]+>")
        .expect("valid html regex")
        .replace_all(value, " ")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
