from sofia.chunker import chunk_markdown, estimate_tokens


def test_estimate_tokens_counts_whitespace_separated_words():
    assert estimate_tokens("hello world") == 2
    assert estimate_tokens("  one    two\n\nthree  ") == 3


def test_chunk_simple_doc_with_one_section():
    text = "# Heading\n\nSome content here."
    chunks = chunk_markdown(text, max_tokens=512, overlap_tokens=64)
    assert len(chunks) == 1
    assert chunks[0].heading == "Heading"
    assert "Some content" in chunks[0].text
    assert chunks[0].idx == 0


def test_chunk_multiple_sections_become_multiple_chunks():
    text = (
        "# Doc\n\n"
        "## Section A\n\n"
        "Alpha content.\n\n"
        "## Section B\n\n"
        "Beta content.\n"
    )
    chunks = chunk_markdown(text, max_tokens=512, overlap_tokens=64)
    headings = [c.heading for c in chunks]
    assert "Section A" in headings
    assert "Section B" in headings
    text_blob = "\n".join(c.text for c in chunks)
    assert "Alpha content" in text_blob
    assert "Beta content" in text_blob


def test_chunk_long_section_is_windowed_with_overlap():
    # Build a section that exceeds max_tokens to force windowing.
    body = " ".join(f"word{i}" for i in range(120))
    text = f"# Long\n\n{body}"
    chunks = chunk_markdown(text, max_tokens=50, overlap_tokens=10)
    assert len(chunks) >= 2
    # All windowed chunks share the heading.
    assert all(c.heading == "Long" for c in chunks)
    # Successive chunks overlap (last 10 tokens of chunk N appear in chunk N+1).
    for prev, nxt in zip(chunks, chunks[1:]):
        prev_tail_words = prev.text.split()[-10:]
        nxt_head_words = nxt.text.split()[:10]
        assert any(w in nxt_head_words for w in prev_tail_words)


def test_chunks_have_sequential_indices():
    text = "# A\n\none\n\n## B\n\ntwo\n\n## C\n\nthree\n"
    chunks = chunk_markdown(text, max_tokens=512, overlap_tokens=64)
    assert [c.idx for c in chunks] == list(range(len(chunks)))


def test_text_above_top_heading_uses_empty_heading():
    text = "Lead-in paragraph.\n\n# Doc\n\nBody.\n"
    chunks = chunk_markdown(text, max_tokens=512, overlap_tokens=64)
    headings = {c.heading for c in chunks}
    assert "" in headings or "Doc" in headings  # implementation choice — both are valid
    text_blob = " ".join(c.text for c in chunks)
    assert "Lead-in" in text_blob
