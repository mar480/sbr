#!/usr/bin/env python3
"""Extract an ACCA/BPP-style HTML question bank to topic-organised Markdown.

Default output:
  output/
    index.md
    extraction-report.md
    questions/Q011-robby.md
    topics/ifrs-3-business-combinations.md

Relative images are embedded as base64 data URIs when the corresponding image
file exists beneath the HTML file's directory (or --assets-root). Missing
assets are preserved as relative links and listed in extraction-report.md.
"""

from __future__ import annotations

import argparse
import base64
import copy
import html as html_lib
import mimetypes
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urlparse

from bs4 import BeautifulSoup, NavigableString, Tag
from markdownify import MarkdownConverter


TOPIC_ROWS: list[tuple[str, str, str]] = [
    ("IAS 8 Accounting Policies", "32, 34", "2"),
    ("Additional performance measures (APMs)", "34; Mock exam 2: Q4", "18"),
    ("Associates", "6, 12, 13, 18, 38; Mock exam 2: Q1", "11–13"),
    ("IFRS 3 Business combinations", "11–19, 59; Mock exam 1: Q1; Mock exam 2: Q1, Q2; Mock exam 3: Q1; Mock exam 4: Q1", "11–16"),
    ("Conceptual Framework", "11, 32, 36, 42, 45, 50, 61; Mock exam 2: Q4; Mock exam 3: Q4", "1"),
    ("Consolidated statement of cash flows", "10, 12, 13, 16, 26", "17"),
    ("Current issues", "27, 28, 31, 45, 46, 50", "19, 21"),
    ("IAS 12 Deferred tax", "12, 26, 33, 37, 58; Mock exam 2: Q1", "7"),
    ("Disposals of investments", "7, 12, 15, 16, 19", "13"),
    ("Ethics", "20–26; All mock exams: Q2", "2"),
    ("IAS 10 Events after the reporting period", "52, 53", "8"),
    ("Employee benefits (including pensions)", "3, 4, 17, 18, 28, 30, 31, 49; Mock exam 3: Q1", "5"),
    ("IFRS 13 Fair value measurement", "39, 51, 50, 55, 57; Mock exam 2: Q3", "4"),
    ("IFRS 9 Financial instruments", "12, 13, 14, 22, 24, 28, 45, 47, 52, 53, 54, 55, 57, 58; Mock exam 2: Q1; Mock exam 3: Q1, Q3", "6"),
    ("IAS 21 Foreign transactions and entities", "9, 14, 19, 61; Mock exam 3: Q3", "16"),
    ("IFRS for SMEs Accounting Standards", "30, 59", "20"),
    ("IFRS Practice Statement 1 Management Commentary", "33", "19"),
    ("IFRS Practice Statement 2 Making Materiality Judgments", "36, 44, 46, 47, 50; Mock exam 1: Q4", "1"),
    ("IAS 36 Impairment", "22, 29, 37, 41, 42, 45", "4"),
    ("IAS 38 Intangible assets", "20, 28, 32, 36, 39, 40, 41, 44, 51, 59; Mock exam 3: Q4", "4"),
    ("IAS 40 Investment property", "52, 58, 59, 61", "4"),
    ("IFRS 11 Joint arrangements", "11, 15, 38, 53", "15"),
    ("IFRS 16 Leases", "31, 37, 39, 40, 43, 44, 55; Mock exam 3: Q3", "9"),
    ("IFRS 5 Non-current assets held for sale and discontinued operations", "40, 41, 51, 52, 61; Mock exam 3: Q3", "14"),
    ("Provisions, contingent liabilities and contingent assets", "24, 25, 28, 31, 45, 49, 50, 60; Mock exam 1: Q2", "8"),
    ("IAS 24 Related party transactions", "25, 46, 47, 51; Mock exam 1: Q2; Mock exam 2: Q2", "2"),
    ("IFRS 15 Revenue recognition", "23, 34, 37, 39, 43, 44, 60, 61; Mock exam 3: Q3", "3"),
    ("IFRS 8 Operating segments", "35, 36; Mock exam 3: Q4", "19"),
    ("IFRS 2 Share-based payment", "56; Mock exam 1: Q1", "10"),
    ("IFRS 10 Step acquisitions", "8, 13; Mock exam 1: Q1; Mock exam 2: Q1", "12"),
    ("Sustainability", "26, 29, 31, 46", "19"),
]


@dataclass(frozen=True)
class Topic:
    name: str
    question_spec: str
    chapter: str
    numeric_questions: frozenset[int]


@dataclass
class ExtractedQuestion:
    number: int
    title: str
    filename: str
    topics: list[Topic]
    markdown: str


def slugify(value: str) -> str:
    value = html_lib.unescape(value)
    value = re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower()
    return value or "untitled"


def expand_numeric_question_spec(spec: str) -> frozenset[int]:
    """Extract ordinary numeric questions, intentionally excluding mock refs."""
    ordinary = spec.split(";")[0]
    numbers: set[int] = set()
    for token in ordinary.split(","):
        token = token.strip()
        if not token:
            continue
        match = re.fullmatch(r"(\d+)\s*[–—-]\s*(\d+)", token)
        if match:
            start, end = map(int, match.groups())
            numbers.update(range(min(start, end), max(start, end) + 1))
        elif token.isdigit():
            numbers.add(int(token))
    return frozenset(numbers)


def build_topics() -> list[Topic]:
    return [Topic(name, spec, chapter, expand_numeric_question_spec(spec)) for name, spec, chapter in TOPIC_ROWS]


class QuestionMarkdownConverter(MarkdownConverter):
    """Markdownify extension that embeds local images and preserves useful HTML."""

    def __init__(self, *, assets_root: Path, missing_assets: set[str], embed_images: bool, **options):
        super().__init__(**options)
        self.assets_root = assets_root
        self.missing_assets = missing_assets
        self.embed_images = embed_images

    def convert_img(self, el: Tag, text: str, parent_tags: set[str]) -> str:
        src = (el.get("src") or "").strip()
        alt = (el.get("alt") or "image").strip()
        title = (el.get("title") or "").strip()
        if not src:
            return ""

        final_src = src
        if self.embed_images and not src.startswith(("data:", "http://", "https://")):
            parsed = urlparse(src)
            rel = unquote(parsed.path).lstrip("/\\")
            candidate = (self.assets_root / rel).resolve()
            try:
                candidate.relative_to(self.assets_root.resolve())
            except ValueError:
                self.missing_assets.add(src + " (outside assets root)")
            else:
                if candidate.is_file():
                    mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
                    payload = base64.b64encode(candidate.read_bytes()).decode("ascii")
                    final_src = f"data:{mime};base64,{payload}"
                else:
                    self.missing_assets.add(src)

        title_part = f' "{title}"' if title else ""
        return f"![{alt}]({final_src}{title_part})"

    def convert_sup(self, el: Tag, text: str, parent_tags: set[str]) -> str:
        return f"<sup>{text}</sup>"

    def convert_sub(self, el: Tag, text: str, parent_tags: set[str]) -> str:
        return f"<sub>{text}</sub>"

    def convert_u(self, el: Tag, text: str, parent_tags: set[str]) -> str:
        return f"<u>{text}</u>"


def clean_tree(root: Tag) -> Tag:
    root = copy.copy(root)
    for unwanted in root.select(
        "script, style, button, input, iframe, .vst-ignore, .vst-skip, "
        "[onclick], [style*='visibility:hidden']"
    ):
        unwanted.decompose()

    # Remove empty anchors used only as internal IDs.
    for anchor in root.find_all("a"):
        if not anchor.get("href") and not anchor.get_text(strip=True) and not anchor.find("img"):
            anchor.decompose()

    # Avoid repeated nested formatting such as <b><b>text</b></b>.
    for tag_name in ("b", "strong", "i", "em", "u"):
        for tag in root.find_all(tag_name):
            child_tags = [c for c in tag.children if isinstance(c, Tag)]
            text_nodes = [c for c in tag.children if isinstance(c, NavigableString) and c.strip()]
            if len(child_tags) == 1 and not text_nodes and child_tags[0].name == tag_name:
                tag.unwrap()

    return root


def to_markdown(root: Tag, converter: QuestionMarkdownConverter) -> str:
    cleaned = clean_tree(root)
    md = converter.convert_soup(cleaned)
    md = md.replace("\xa0", " ")
    md = re.sub(r"[ \t]+\n", "\n", md)
    md = re.sub(r"\n{3,}", "\n\n", md)
    md = re.sub(r"\*\*\s*\*\*", "", md)
    md = re.sub(r"_{4,}", "", md)
    return md.strip()


def extract_number(qbank: Tag) -> int:
    for candidate in (qbank.get("about"), qbank.get("id")):
        if candidate:
            match = re.search(r"(\d+)$", str(candidate))
            if match:
                return int(match.group(1))
    raise ValueError("Could not determine question number")


def extract_title(qbank: Tag, number: int) -> str:
    header = qbank.select_one("p.question-header")
    if not header:
        return f"Question {number}"
    return re.sub(r"\s+", " ", header.get_text(" ", strip=True)).strip()


def find_canonical_solution(qbank: Tag, number: int) -> Tag | None:
    preferred = qbank.select_one(f"#debriefReveal{number}")
    if preferred:
        return preferred
    preferred = qbank.select_one("div.debriefReveal:has(.solution-heading)")
    if preferred:
        return preferred
    return qbank.select_one(f"#AATDebrief{number}, div[id^='AATDebrief']")


def prepare_question_tree(container: Tag, number: int) -> Tag:
    tree = copy.copy(container)
    # Strip all answer/debrief copies from the question portion.
    selectors = [
        f"#debriefReveal{number}",
        f"#AATDebrief{number}",
        "div[id^='debriefReveal']",
        "div[id^='AATDebrief']",
        ".solution-heading",
        ".AAT-solution-heading",
    ]
    for node in tree.select(", ".join(selectors)):
        node.decompose()

    # Remove the separate left-hand number because it is in the heading/front matter.
    for node in tree.select("p.question-header-numbering"):
        node.decompose()
    return tree


def yaml_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def question_document(number: int, title: str, topics: list[Topic], question_md: str, solution_md: str) -> str:
    lines = [
        "---",
        f"question_number: {number}",
        f"title: {yaml_quote(title)}",
        "topics:",
    ]
    if topics:
        lines.extend(f"  - {yaml_quote(topic.name)}" for topic in topics)
    else:
        lines.append("  []")
    chapters = sorted({topic.chapter for topic in topics})
    lines.append("course_book_chapters:")
    if chapters:
        lines.extend(f"  - {yaml_quote(chapter)}" for chapter in chapters)
    else:
        lines.append("  []")
    lines.extend(["---", "", f"# Question {number} — {title}", ""])

    if topics:
        lines.extend([
            "## Topic classification",
            "",
            *[f"- **{topic.name}** — Course Book chapter {topic.chapter}" for topic in topics],
            "",
        ])

    lines.extend(["## Question", "", question_md, "", "## Solution", "", solution_md or "_No solution container found._", ""])
    return "\n".join(lines)


def write_topic_pages(output_dir: Path, questions: list[ExtractedQuestion], topics: list[Topic]) -> None:
    topic_dir = output_dir / "topics"
    topic_dir.mkdir(parents=True, exist_ok=True)
    by_number = {q.number: q for q in questions}

    for topic in topics:
        page = [f"# {topic.name}", "", f"**Course Book chapter:** {topic.chapter}", "", f"**Source mapping:** {topic.question_spec}", "", "## Questions", ""]
        matched = [by_number[n] for n in sorted(topic.numeric_questions) if n in by_number]
        if matched:
            for q in matched:
                page.append(f"- [Question {q.number}: {q.title}](../questions/{q.filename})")
        else:
            page.append("_No matching ordinary questions were found in this HTML file._")
        page.append("")
        (topic_dir / f"{slugify(topic.name)}.md").write_text("\n".join(page), encoding="utf-8")


def write_index(output_dir: Path, questions: list[ExtractedQuestion], topics: list[Topic]) -> None:
    lines = ["# Question bank", "", "## Browse by topic", ""]
    for topic in topics:
        count = sum(1 for q in questions if topic in q.topics)
        lines.append(f"- [{topic.name}](topics/{slugify(topic.name)}.md) — {count} extracted question(s); Course Book chapter {topic.chapter}")
    lines.extend(["", "## Browse by question number", ""])
    for q in sorted(questions, key=lambda item: item.number):
        topic_text = ", ".join(t.name for t in q.topics) or "Unclassified"
        lines.append(f"- [Question {q.number}: {q.title}](questions/{q.filename}) — {topic_text}")
    lines.append("")
    (output_dir / "index.md").write_text("\n".join(lines), encoding="utf-8")


def extract(html_path: Path, output_dir: Path, assets_root: Path, embed_images: bool) -> tuple[list[ExtractedQuestion], set[str]]:
    soup = BeautifulSoup(html_path.read_text(encoding="utf-8"), "html.parser")
    qbanks = soup.select("div[id^='QnABank']")
    if not qbanks:
        raise RuntimeError("No question blocks matching div[id^='QnABank'] were found")

    topics = build_topics()
    missing_assets: set[str] = set()
    converter = QuestionMarkdownConverter(
        assets_root=assets_root,
        missing_assets=missing_assets,
        embed_images=embed_images,
        heading_style="ATX",
        bullets="-",
        strip=["span"],
    )

    question_dir = output_dir / "questions"
    question_dir.mkdir(parents=True, exist_ok=True)
    extracted: list[ExtractedQuestion] = []

    for qbank in qbanks:
        number = extract_number(qbank)
        title = extract_title(qbank, number)
        container = qbank.parent if isinstance(qbank.parent, Tag) else qbank
        solution = find_canonical_solution(qbank, number)
        question_tree = prepare_question_tree(container, number)
        question_md = to_markdown(question_tree, converter)
        solution_md = to_markdown(solution, converter) if solution else ""
        matched_topics = [topic for topic in topics if number in topic.numeric_questions]
        filename = f"Q{number:03d}-{slugify(title)[:80]}.md"
        content = question_document(number, title, matched_topics, question_md, solution_md)
        (question_dir / filename).write_text(content, encoding="utf-8")
        extracted.append(ExtractedQuestion(number, title, filename, matched_topics, content))

    write_topic_pages(output_dir, extracted, topics)
    write_index(output_dir, extracted, topics)
    return extracted, missing_assets


def write_report(output_dir: Path, html_path: Path, extracted: list[ExtractedQuestion], missing_assets: set[str], embed_images: bool) -> None:
    lines = [
        "# Extraction report",
        "",
        f"- Source: `{html_path}`",
        f"- Questions extracted: {len(extracted)}",
        f"- Question range: {min(q.number for q in extracted)}–{max(q.number for q in extracted)}",
        f"- Image mode: {'base64 embedding' if embed_images else 'preserve source paths'}",
        f"- Missing image assets: {len(missing_assets)}",
        "",
    ]
    if missing_assets:
        lines.extend(["## Missing image assets", "", "The HTML referenced these files, but they were not present beneath the assets root. Their original paths remain in the Markdown.", ""])
        lines.extend(f"- `{asset}`" for asset in sorted(missing_assets))
        lines.append("")
    (output_dir / "extraction-report.md").write_text("\n".join(lines), encoding="utf-8")


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path, help="Question-bank HTML file")
    parser.add_argument("-o", "--output", type=Path, default=Path("question-bank-md"), help="Output directory")
    parser.add_argument("--assets-root", type=Path, help="Directory used to resolve relative image paths (default: HTML directory)")
    parser.add_argument("--no-embed-images", action="store_true", help="Keep image paths instead of embedding local files as base64")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    html_path = args.html.resolve()
    output_dir = args.output.resolve()
    assets_root = (args.assets_root or html_path.parent).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        extracted, missing_assets = extract(html_path, output_dir, assets_root, not args.no_embed_images)
        write_report(output_dir, html_path, extracted, missing_assets, not args.no_embed_images)
    except Exception as exc:
        print(f"Extraction failed: {exc}", file=sys.stderr)
        return 1

    print(f"Extracted {len(extracted)} questions to {output_dir}")
    if missing_assets:
        print(f"Warning: {len(missing_assets)} referenced image asset(s) were missing; see extraction-report.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())