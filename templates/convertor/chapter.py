from __future__ import annotations

from bs4 import BeautifulSoup, NavigableString, Tag
from pathlib import Path
import re
import string

# --- CONFIG: set these to your folders ---
html_folder = Path(r"C:\Users\r.marks\OneDrive - Financial Reporting Council\Desktop\html")
md_folder   = Path(r"C:\Users\r.marks\OneDrive - Financial Reporting Council\Desktop\md")
md_folder.mkdir(parents=True, exist_ok=True)

SKIP_TAGS = {"script", "style", "link", "template", "svg", "button", "input", "mosaic-plugin-image-tools"}
SKIP_CLASSES = {
    "vstskip", "vstignore", "vst-skip", "vst-skip-enhanced-formatting",
    "IconButton__button-dKyLMX", "button", "bluebutton", "orangebutton",
    "activity-image", "blue-box-image", "total-marks-here", "no-marks", "question-marks",
}


def useful_classes(tag: Tag) -> set[str]:
    return {c for c in (tag.get("class") or []) if not c.startswith("comment")}


def clean_text(text: str) -> str:
    text = text.replace("\xa0", " ")
    text = text.replace("\u200b", "")
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\s+([,.;:!?])", r"\1", text)
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    text = re.sub(r" {2,}", " ", text)
    return text.strip()


def wrap_markdown(text: str, marker: str) -> str:
    if not text or not text.strip():
        return text
    leading = re.match(r"^\s*", text).group(0)
    trailing = re.search(r"\s*$", text).group(0)
    core = text.strip()
    return f"{leading}{marker}{core}{marker}{trailing}"


def render_inline(node, *, bold_active=False, italic_active=False, underline_active=False) -> str:
    """Render inline-ish HTML as Markdown, preserving common formatting."""
    if isinstance(node, NavigableString):
        return str(node).replace("*", r"\*")

    if not isinstance(node, Tag):
        return ""

    name = node.name.lower()
    cls = useful_classes(node)

    if name in SKIP_TAGS or (cls & SKIP_CLASSES):
        return ""

    # Empty anchors are index markers in these files, not visible content.
    if name == "a" and node.get("id") and not node.get_text(strip=True):
        return ""

    if name == "br":
        return "\n"

    if name == "img":
        alt = clean_text(node.get("alt") or "")
        src = node.get("src") or ""
        if alt:
            return f"![{alt}]({src})"
        return ""

    if name == "iframe":
        src = node.get("src") or ""
        if src:
            return f"[Embedded video]({src})"
        return ""

    inner = "".join(
        render_inline(
            child,
            bold_active=bold_active or name in ("b", "strong"),
            italic_active=italic_active or name in ("i", "em", "cite"),
            underline_active=underline_active or name == "u",
        )
        for child in node.children
    )

    if name in ("b", "strong"):
        return inner if bold_active else wrap_markdown(inner, "**")

    if name in ("i", "em", "cite"):
        return inner if italic_active else wrap_markdown(inner, "*")

    # Markdown has no native underline. Keep it as HTML so totals/underlines survive.
    if name == "u":
        return inner if underline_active else f"<u>{clean_text(inner)}</u>"

    return inner


def render_inline_clean(tag_or_node) -> str:
    return clean_text(render_inline(tag_or_node))


def alpha_marker(index: int) -> str:
    letters = string.ascii_lowercase
    if index <= 26:
        return letters[index - 1]
    return letters[(index - 1) // 26 - 1] + letters[(index - 1) % 26]


def roman(n: int) -> str:
    vals = [(10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
    out = []
    for value, symbol in vals:
        while n >= value:
            out.append(symbol)
            n -= value
    return "".join(out)


def list_marker(list_tag: Tag, index: int) -> str:
    if list_tag.name == "ul":
        return "-"
    list_type = (list_tag.get("type") or "1").lower()
    if list_type == "a":
        return f"{alpha_marker(index)}."
    if list_type == "i":
        return f"{roman(index)}."
    return f"{index}."


def render_list(list_tag: Tag, indent_level: int = 0) -> list[str]:
    lines: list[str] = []
    indent = "    " * indent_level
    for i, li in enumerate(list_tag.find_all("li", recursive=False), start=1):
        inline_parts = []
        nested = []
        for child in li.children:
            if isinstance(child, Tag) and child.name in ("ol", "ul"):
                nested.append(child)
            else:
                inline_parts.append(render_inline(child))
        text = clean_text("".join(inline_parts))
        marker = list_marker(list_tag, i)
        lines.append(f"{indent}{marker} {text}" if text else f"{indent}{marker}")
        for n in nested:
            lines.extend(render_list(n, indent_level + 1))
    return lines


def cell_text(cell: Tag) -> str:
    parts = []
    for child in cell.children:
        if isinstance(child, Tag) and child.name in ("ol", "ul"):
            parts.append("<br>".join(render_list(child)))
        else:
            parts.append(render_inline(child))
    text = clean_text("".join(parts))
    text = text.replace("|", r"\|")
    text = text.replace("\n", "<br>")
    return text


def trim_empty_edges(rows: list[list[str]]) -> list[list[str]]:
    rows = [r[:] for r in rows if any(c.strip() for c in r)]
    if not rows:
        return rows
    width = max(len(r) for r in rows)
    for r in rows:
        r.extend([""] * (width - len(r)))

    # Drop empty left/right columns.
    while rows and all(not r[0].strip() for r in rows):
        rows = [r[1:] for r in rows]
    while rows and all(not r[-1].strip() for r in rows):
        rows = [r[:-1] for r in rows]
    return rows


def table_to_markdown(table: Tag) -> str:
    """Convert real content tables. Removes spreadsheet UI chrome where present."""
    classes = useful_classes(table)
    rows: list[list[str]] = []

    if "spreadsheetheader-nocaption" in classes:
        # Ignore fake spreadsheet toolbar/header rows; keep the sheet body.
        for tr in table.find_all("tbody", recursive=False)[0].find_all("tr", recursive=False) if table.find("tbody", recursive=False) else []:
            cells = tr.find_all(["th", "td"], recursive=False)
            row = [cell_text(c) for c in cells]
            # Drop row-number column if present.
            if row and re.fullmatch(r"\d+", row[0] or ""):
                row = row[1:]
            rows.append(row)
    else:
        for tr in table.find_all("tr"):
            cells = tr.find_all(["th", "td"], recursive=False)
            if not cells:
                continue
            row = [cell_text(c) for c in cells]
            rows.append(row)

    rows = trim_empty_edges(rows)
    if not rows:
        return ""

    width = max(len(r) for r in rows)
    for r in rows:
        r.extend([""] * (width - len(r)))

    # Pick first non-empty row as header. For journal tables this will often be $m/$m, which is still useful.
    header = rows[0]
    body = rows[1:]

    # If the first row is empty after trimming, create a generic header.
    if not any(c.strip() for c in header):
        header = [f"Column {i}" for i in range(1, width + 1)]

    md = ["| " + " | ".join(header) + " |", "| " + " | ".join(["---"] * width) + " |"]
    for r in body:
        md.append("| " + " | ".join(r) + " |")
    return "\n".join(md)


def is_empty_paragraph(tag: Tag) -> bool:
    return tag.name == "p" and not render_inline_clean(tag)


def heading_from_container(div: Tag) -> tuple[int, str] | None:
    """Detect ACCA heading rows where number and title are split across two divs."""
    ps = [p for p in div.find_all("p") if p.get("class")]
    if not ps:
        return None
    items = []
    for p in ps:
        cls = useful_classes(p)
        text = render_inline_clean(p)
        if not text:
            continue
        if "knowledge-section-header" in cls:
            items.append((2, text))
        elif "knowledge-sub-section-header" in cls:
            items.append((3, text))
        elif "knowledge-sub-sub-section-header" in cls:
            items.append((4, text))
    if not items:
        return None
    level = max(i[0] for i in items)  # deepest wins if mixed
    texts = [t for lvl, t in items if lvl == level]
    if len(texts) >= 2 and re.fullmatch(r"\d+(\.\d+)*", texts[0]):
        return level, f"{texts[0]} {texts[1]}"
    return level, texts[-1]


def as_blockquote(lines: list[str]) -> list[str]:
    """Prefix a block with Markdown blockquote markers line-by-line."""
    out: list[str] = []
    for line in lines:
        split = str(line).splitlines() or [""]
        for part in split:
            out.append(f"> {part}" if part else ">")
    return out


def render_p_without_title_span(p: Tag, title_tag: Tag) -> list[str]:
    """Render a paragraph that begins with a title span, excluding that title."""
    parts = []
    seen = False
    for child in p.children:
        if child is title_tag:
            seen = True
            continue
        if not seen and isinstance(child, NavigableString) and not child.strip():
            continue
        if not seen and isinstance(child, Tag) and child.get_text(strip=True) == title_tag.get_text(strip=True):
            seen = True
            continue
        # Most note paragraphs put the header first, but if there is content before it, keep it.
        parts.append(render_inline(child))
    text = clean_text("".join(parts))
    return [text, ""] if text else []


def render_key_terms(div: Tag) -> list[str]:
    container = div.find(class_="key-term-container")
    if not container:
        return []
    inner: list[str] = ["**Key terms**", ""]
    for p in container.find_all("p", recursive=False):
        text_lines = render_block_children(p)
        if text_lines:
            inner.extend(text_lines)
    return as_blockquote(inner) + [""]


def render_callout(div: Tag, title_class: str, default_title: str) -> list[str]:
    title_tag = div.find(class_=title_class)
    container = title_tag.find_parent("div") if title_tag else div
    title = render_inline_clean(title_tag) if title_tag else default_title
    title = clean_text(title.rstrip(".")) or default_title

    inner: list[str] = [f"**{title}**", ""]
    for child in container.children:
        if not isinstance(child, Tag):
            continue
        if child is title_tag:
            continue
        # If a paragraph contains the title span, render only the text after the span.
        if child.name == "p" and title_tag is not None and title_tag in child.find_all(True):
            inner.extend(render_p_without_title_span(child, title_tag))
            continue
        for line in render_block(child):
            inner.append(line)
    return as_blockquote(inner) + [""]



def render_numbered_subcontainer(div: Tag) -> list[str]:
    """Render two-column question/answer subcontainers as labelled parts."""
    direct_divs = [c for c in div.children if isinstance(c, Tag) and c.name == "div"]
    number = ""
    content_divs = direct_divs
    if direct_divs:
        first_text = render_inline_clean(direct_divs[0])
        if re.fullmatch(r"\d+|[a-zA-Z]", first_text):
            number = first_text
            content_divs = direct_divs[1:]

    lines: list[str] = []
    if number:
        lines.extend([f"**Part {number}**", ""])

    if content_divs:
        for c in content_divs:
            lines.extend(render_block(c))
    else:
        for child in div.children:
            if isinstance(child, Tag):
                lines.extend(render_block(child))
    return lines

def render_activity(div: Tag) -> list[str]:
    title = div.find("p", class_="activity-title")
    title_text = render_inline_clean(title) if title else "Activity"
    lines = [f"#### {title_text}", ""]

    # Render all meaningful descendants inside the activity, but avoid buttons/images and avoid duplicating title.
    group = div.find(class_="crq-question-group") or div
    for child in group.children:
        if not isinstance(child, Tag):
            continue
        if child is title or child.find_parent(class_="activity-image"):
            continue
        if useful_classes(child) & {"activity-image", "no-marks", "total-marks-here"}:
            continue
        lines.extend(render_block(child))
    return lines


def render_illustration(div: Tag) -> list[str]:
    title = div.find("p", class_="illustration-header")
    title_text = render_inline_clean(title) if title else "Illustration"
    lines = [f"#### {title_text}", ""]
    container = div.find(class_="illustration-container") or div
    for child in container.children:
        if not isinstance(child, Tag) or child is title:
            continue
        lines.extend(render_block(child))
    return lines


def render_step(div: Tag) -> list[str] | None:
    step = div.find(class_="steps-numbering")
    if not step:
        return None
    step_text = render_inline_clean(step)
    # The meaningful description is usually the p in the following content div.
    ps = [p for p in div.find_all("p") if p is not step and render_inline_clean(p)]
    desc = ""
    for p in ps:
        t = render_inline_clean(p)
        if t != step_text:
            desc = t
            break
    if not desc:
        return [f"- **{step_text}**"]
    return [f"- **{step_text}:** {desc}", ""]


def render_block_children(tag: Tag, blockquote: bool = False) -> list[str]:
    # Used for malformed paragraphs that contain block children such as <ol> inside <p>.
    lines: list[str] = []
    inline_parts = []
    for child in tag.children:
        if isinstance(child, Tag) and child.name in ("ol", "ul", "table", "div"):
            txt = clean_text("".join(inline_parts))
            if txt:
                lines.append(txt)
                lines.append("")
            inline_parts = []
            lines.extend(render_block(child))
        else:
            inline_parts.append(render_inline(child))
    txt = clean_text("".join(inline_parts))
    if txt:
        lines.append(txt)
        lines.append("")
    return lines


def render_block(tag: Tag) -> list[str]:
    if not isinstance(tag, Tag):
        return []
    name = tag.name.lower()
    cls = useful_classes(tag)

    if name in SKIP_TAGS or (cls & SKIP_CLASSES):
        return []
    if is_empty_paragraph(tag):
        return []

    # Specific semantic blocks first. Containers must be recognised before
    # nested callouts, otherwise an Activity containing a Tutorial Note would
    # be reduced to just that note.
    if name == "div" and "question-container-activity" in cls:
        return render_activity(tag)
    if name == "div" and tag.find(class_="illustration-container"):
        return render_illustration(tag)
    if name == "div" and ("question-sub-container" in cls or "question-sub-container-answer" in cls):
        return render_numbered_subcontainer(tag)
    if name == "div" and tag.find(class_="key-term-container"):
        return render_key_terms(tag)
    if name == "div" and "exam-focus-point-container" in cls:
        return render_callout(tag, "exam-focus-point-header", "Exam focus point")
    if name == "div" and "tutorial-note" in cls:
        return render_callout(tag, "tutorial-note-header", "Tutorial note")
    if name == "div" and "note" in cls:
        return render_callout(tag, "note-title", "Note")
    if name == "div" and "prominent-note" in cls:
        return render_callout(tag, "prominent-note-title", "Note")

    heading = heading_from_container(tag) if name == "div" else None
    if heading:
        level, text = heading
        return ["#" * level + " " + text, ""]

    step_lines = render_step(tag) if name == "div" else None
    if step_lines:
        return step_lines

    if name == "p" and "chapter-heading" in cls:
        return ["# " + render_inline_clean(tag), ""]
    if name == "h2" and "learning-outcomes-header" in cls:
        return ["## " + render_inline_clean(tag), ""]
    if name == "h2" and "nonnumsection-title" in cls:
        return ["## " + render_inline_clean(tag), ""]
    if name == "p" and "chapter-summary-header" in cls:
        return ["## " + render_inline_clean(tag), ""]
    if name == "p" and "activity-title" in cls:
        return ["#### " + render_inline_clean(tag), ""]
    if name == "p" and "illustration-header" in cls:
        return ["#### " + render_inline_clean(tag), ""]
    if name == "p" and "question-requirement-title" in cls:
        return ["**Required**", ""]
    if name == "p" and "solution-heading" in cls:
        return ["**Solution**", ""]
    if name == "p" and "ill-solution-title" in cls:
        return ["**Solution**", ""]
    if name == "p" and "knowledge-diagnostic-title" in cls:
        return ["#### " + render_inline_clean(tag), ""]
    if name == "p" and "further-study-guidance-group-title" in cls:
        return ["### " + render_inline_clean(tag), ""]
    if name == "p" and "further-study-guidance-title" in cls:
        return ["#### " + render_inline_clean(tag), ""]

    if name in ("h1", "h2", "h3", "h4", "h5", "h6"):
        text = render_inline_clean(tag)
        if not text:
            return []
        return ["#" * int(name[1]) + " " + text, ""]

    if name in ("ol", "ul"):
        lines = render_list(tag)
        return lines + ([""] if lines else [])

    if name == "table":
        md = table_to_markdown(tag)
        return [md, ""] if md else []

    if name == "p":
        # Some source paragraphs illegally contain block children; handle those without flattening lists.
        if tag.find(["ol", "ul", "table", "div"], recursive=False):
            return render_block_children(tag)
        text = render_inline_clean(tag)
        if not text or text in {"Check solution", "Launch CBE software"}:
            return []
        return [text, ""]

    if name == "iframe":
        text = render_inline_clean(tag)
        return [text, ""] if text else []

    if name == "img":
        text = render_inline_clean(tag)
        return [text, ""] if text else []

    if name in ("div", "a"):
        # Generic container: process only direct block children. This keeps order while limiting duplicate recursion.
        lines: list[str] = []
        for child in tag.children:
            if isinstance(child, Tag):
                lines.extend(render_block(child))
        return lines

    return []


def html_to_markdown(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    # Remove noisy plugin material and interactive controls.
    for noisy in soup.find_all(["script", "style", "template", "svg", "mosaic-plugin-image-tools", "button", "input"]):
        noisy.decompose()

    body = soup.body or soup
    lines: list[str] = []
    for child in body.children:
        if isinstance(child, Tag):
            lines.extend(render_block(child))

    md = "\n".join(lines)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip() + "\n"


def convert_file(html_path: Path, md_folder: Path) -> Path:
    """Convert one HTML file and return the generated Markdown path."""
    html = html_path.read_text(encoding="utf-8")
    md = html_to_markdown(html)
    out_path = md_folder / f"{html_path.stem}.md"
    out_path.write_text(md, encoding="utf-8")
    return out_path


def convert_folder(html_folder: Path, md_folder: Path) -> None:
    """Convert every .html/.htm file in html_folder into matching .md files."""
    md_folder.mkdir(parents=True, exist_ok=True)

    html_files = sorted(
        list(html_folder.glob("*.html")) +
        list(html_folder.glob("*.htm"))
    )

    if not html_files:
        print(f"No HTML files found in: {html_folder}")
        return

    converted = 0
    failed = 0

    for html_path in html_files:
        try:
            out_path = convert_file(html_path, md_folder)
            converted += 1
            print(f"Converted {html_path.name} -> {out_path.name}")
        except Exception as exc:
            failed += 1
            print(f"FAILED {html_path.name}: {exc}")

    print()
    print(f"Done. Converted: {converted}. Failed: {failed}. Output folder: {md_folder}")


if __name__ == "__main__":
    convert_folder(html_folder, md_folder)
