from bs4 import BeautifulSoup, NavigableString, Tag
from pathlib import Path
import re
import string

# --- CONFIG ---
html_path = Path(r"C:\Users\r.marks\OneDrive - Financial Reporting Council\Desktop\html\glossary.html")
md_path   = Path(r"C:\Users\r.marks\OneDrive - Financial Reporting Council\Desktop\md\glossary.md")
md_path.parent.mkdir(parents=True, exist_ok=True)


def clean_inline(text: str) -> str:
    """Normalise inline whitespace without destroying Markdown formatting."""
    text = text.replace("\xa0", " ")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    return text.strip()


def render_inline(node, *, bold_active=False, italic_active=False) -> str:
    """
    Render inline HTML to Markdown.

    Document-specific behaviour:
    - preserves <b> and <strong> as Markdown bold
    - collapses nested <b><b>...</b></b> into one **...**
    - preserves <i> and <em> as Markdown italic
    - ignores empty index anchors like <a id="Index_41"/>
    - keeps visible text inside spans
    - treats <br/> as a line break
    """

    if isinstance(node, NavigableString):
        return str(node).replace("*", r"\*")

    if not isinstance(node, Tag):
        return ""

    name = node.name.lower()

    if name in ("script", "style", "link"):
        return ""

    if name == "br":
        return "\n"

    # The glossary uses empty anchors as index markers. They should not appear.
    if name == "a" and node.get("id") and not node.get_text(strip=True):
        return ""

    inner = "".join(
        render_inline(
            child,
            bold_active=bold_active or name in ("b", "strong"),
            italic_active=italic_active or name in ("i", "em"),
        )
        for child in node.children
    )

    if name in ("b", "strong"):
        if bold_active:
            return inner
        return wrap_markdown(inner, "**")

    if name in ("i", "em"):
        if italic_active:
            return inner
        return wrap_markdown(inner, "*")

    return inner


def wrap_markdown(text: str, marker: str) -> str:
    """
    Wrap text in Markdown markers while preserving external spacing.

    Example:
        " members of the same group" -> " **members of the same group**"

    This matters because the source sometimes has no explicit space before <b>.
    """

    if not text or not text.strip():
        return text

    leading = re.match(r"^\s*", text).group(0)
    trailing = re.search(r"\s*$", text).group(0)
    core = text.strip()

    return f"{leading}{marker}{core}{marker}{trailing}"


def render_inline_clean(node) -> str:
    return clean_inline(render_inline(node))


def get_term_and_definition(p: Tag) -> tuple[str, str]:
    """
    Split a glossary term paragraph into:
    - term from span.glossary-key-term-header
    - definition from the rest of the paragraph
    """

    header = p.find("span", class_="glossary-key-term-header", recursive=False)

    if not header:
        return "", render_inline_clean(p)

    term = render_inline_clean(header)
    term = re.sub(r":\s*$", "", term).strip()

    parts = []
    seen_header = False

    for child in p.children:
        if child is header:
            seen_header = True
            continue
        if not seen_header:
            continue
        parts.append(render_inline(child))

    definition = clean_inline("".join(parts))
    return term, definition


def alpha_marker(index: int) -> str:
    letters = string.ascii_lowercase
    if index <= 26:
        return letters[index - 1]

    # Basic fallback for very long alpha lists.
    return letters[(index - 1) // 26 - 1] + letters[(index - 1) % 26]


def list_marker(list_tag: Tag, index: int) -> str:
    if list_tag.name == "ul":
        return "-"

    list_type = (list_tag.get("type") or "1").lower()

    if list_type == "a":
        return f"{alpha_marker(index)}."

    if list_type == "i":
        # Markdown support for roman markers is inconsistent, so preserve as text.
        romans = [
            "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x",
            "xi", "xii", "xiii", "xiv", "xv"
        ]
        value = romans[index - 1] if index <= len(romans) else str(index)
        return f"{value}."

    return f"{index}."


def render_list(list_tag: Tag, indent_level: int = 0) -> list[str]:
    """
    Render nested <ol>/<ul> structures as Markdown.

    Only direct li children are processed at each level, which avoids duplicating
    nested list text in the parent item.
    """

    lines = []
    indent = "    " * indent_level

    for index, li in enumerate(list_tag.find_all("li", recursive=False), start=1):
        marker = list_marker(list_tag, index)

        inline_parts = []
        nested_lists = []

        for child in li.children:
            if isinstance(child, Tag) and child.name in ("ol", "ul"):
                nested_lists.append(child)
            else:
                inline_parts.append(render_inline(child))

        item_text = clean_inline("".join(inline_parts))

        if item_text:
            lines.append(f"{indent}{marker} {item_text}")
        else:
            lines.append(f"{indent}{marker}")

        for nested in nested_lists:
            lines.extend(render_list(nested, indent_level + 1))

    return lines


def render_term_block(div: Tag) -> list[str]:
    """
    Render one glossary definition block.

    Source shape:
        <div>
          <p class="glossary-key-term-shell">
            <span class="glossary-key-term-header">Term: </span>Definition...
          </p>
          <ol>...</ol>
          <p>continuation / note</p>
        </div>
    """

    first_p = div.find("p", class_="glossary-key-term-shell", recursive=False)
    if not first_p:
        return []

    term, definition = get_term_and_definition(first_p)

    lines = [f"### {term}", ""]

    if definition:
        lines.append(definition)
        lines.append("")

    for child in div.children:
        if not isinstance(child, Tag):
            continue

        if child is first_p:
            continue

        if child.name in ("ol", "ul"):
            rendered = render_list(child)
            if rendered:
                lines.extend(rendered)
                lines.append("")
            continue

        if child.name == "p":
            extra = render_inline_clean(child)
            if extra:
                lines.append(extra)
                lines.append("")
            continue

    return lines


def html_to_markdown(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    body = soup.body

    if body is None:
        raise ValueError("No <body> found in HTML.")

    lines = []

    for child in body.children:
        if not isinstance(child, Tag):
            continue

        # Skip decorative lines and executable/non-content elements.
        if child.name in ("hr", "script", "style"):
            continue

        if child.name == "div" and child.find("p", class_="glossary-heading"):
            heading = child.find("p", class_="glossary-heading")
            text = render_inline_clean(heading)
            if text:
                lines.append(f"# {text}")
                lines.append("")
            continue

        if child.name == "p" and "glossary-heading" in (child.get("class") or []):
            text = render_inline_clean(child)
            if text:
                lines.append(f"# {text}")
                lines.append("")
            continue

        if child.name == "p" and "glossary-chapter-title" in (child.get("class") or []):
            text = render_inline_clean(child)
            if text:
                lines.append(f"## {text}")
                lines.append("")
            continue

        if child.name == "div":
            term_lines = render_term_block(child)
            if term_lines:
                lines.extend(term_lines)
            continue

        # Defensive fallback for unexpected content.
        if child.name == "p":
            text = render_inline_clean(child)
            if text:
                lines.append(text)
                lines.append("")

    md = "\n".join(lines)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip() + "\n"


if __name__ == "__main__":
    html = html_path.read_text(encoding="utf-8")
    md = html_to_markdown(html)
    md_path.write_text(md, encoding="utf-8")
    print(f"Converted {html_path} -> {md_path}")