"""Exact symbolic reference alignment for serving; never modifies the training inventory.

The full-sentence eSpeak token sequence stays unchanged. A token covering more
than one canonical phone can help locate boundaries, but never receives a phone
score. Alternative pronunciations and partitions must agree on scored ownership.
"""
from functools import lru_cache


def _parse(phones):
    from phone_mapping import parse_phone
    return tuple(parse_phone(phone) for phone in phones)


def _transitions(parsed, tokens, mapping):
    @lru_cache(None)
    def covers(start, end, token):
        @lru_cache(None)
        def match(index, offset):
            if index == end:
                return offset == len(token)
            return any(token.startswith(v['token'], offset) and match(index + 1, offset + len(v['token']))
                       for v in mapping.phones[parsed[index][0]]['reference_variants'])
        return match(start, 0)

    def steps(pi, ti):
        if ti < len(tokens):
            for count in range(1, min(3, len(parsed) - pi) + 1):
                if covers(pi, pi + count, tokens[ti]):
                    yield count
    return steps


def pronunciation_ends(phones, tokens, mapping):
    """Lengths of exact prefixes expressing every canonical phone, with no gaps."""
    parsed = _parse(phones)
    steps = _transitions(parsed, tokens, mapping)

    @lru_cache(None)
    def visit(pi, ti):
        if pi == len(parsed):
            return frozenset((ti,))
        return frozenset(end for count in steps(pi, ti) for end in visit(pi + count, ti + 1))
    return visit(0, 0)


def pronunciation_ownership(phones, tokens, mapping):
    """Token -> source-phone indices shared by ALL exact complete alignments.

    None means no complete alignment; an empty dict is an aligned but wholly
    merged/ambiguous word. No substitutions, insertions, deletions or acoustics.
    """
    parsed = _parse(phones)
    steps = _transitions(parsed, tokens, mapping)

    @lru_cache(None)
    def visit(pi, ti):
        if pi == len(parsed):
            return {} if ti == len(tokens) else None
        possibilities = []
        for count in steps(pi, ti):
            suffix = visit(pi + count, ti + 1)
            if suffix is not None:
                ownership = dict(suffix)
                if count == 1:
                    ownership[ti] = pi
                possibilities.append(ownership)
        if not possibilities:
            return None
        common = dict(possibilities[0])
        for candidate in possibilities[1:]:
            common = {k: v for k, v in common.items() if candidate.get(k) == v}
        return common
    return visit(0, 0)


def map_word_consensus(pronunciations, tokens, mapping):
    """Keep only one-to-one token/phone ownership agreed across lexical variants."""
    candidates, seen = [], set()
    for phones in pronunciations:
        try:
            parsed = _parse(phones)
            key = tuple(base for base, _ in parsed)
            if key in seen:
                continue
            seen.add(key)
            ownership = pronunciation_ownership(phones, tuple(tokens), mapping)
        except ValueError:
            continue
        if ownership is None:
            continue
        records = {}
        for target, source in ownership.items():
            base, stress = parsed[source]
            records[target] = {'source_index': source, 'source_phone': phones[source], 'base_phone': base,
                               'stress': stress, 'teacher_score': None,
                               'canonical_token': mapping.phones[base]['canonical_token'],
                               'target_token': tokens[target], 'target_id': mapping.vocab[tokens[target]]}
        candidates.append(records)
    if not candidates:
        return []
    common = dict(candidates[0])
    for candidate in candidates[1:]:
        common = {k: v for k, v in common.items() if k in candidate and candidate[k]['base_phone'] == v['base_phone']}
    return sorted(common.items())


def restore_boundaries(pronunciations, chunks, isolated, mapping):
    """Recover only a unique exact partition, considering all lexical variants.

    Isolated eSpeak is boundary evidence only (including out-of-dictionary names),
    never the source of canonical scored phones. A word never splits a model token.
    """
    if len(chunks) == len(pronunciations):
        return chunks
    if not chunks or len(chunks) > len(pronunciations):
        return None
    chunks = tuple(tuple(chunk) for chunk in chunks)

    @lru_cache(None)
    def ends(wi, ci, offset):
        tokens = chunks[ci][offset:]
        result = set()
        for phones in pronunciations[wi]:
            try:
                result.update(pronunciation_ends(phones, tokens, mapping))
            except ValueError:
                continue
        reference = tuple(isolated[wi])
        if reference and tokens[:len(reference)] == reference:
            result.add(len(reference))
        return tuple(sorted(n for n in result if n > 0))

    @lru_cache(None)
    def split_chunk(wi, count, ci, offset=0):
        if count == 0:
            return [()] if offset == len(chunks[ci]) else []
        paths = []
        for length in ends(wi, ci, offset):
            for suffix in split_chunk(wi + 1, count - 1, ci, offset + length):
                path = (length,) + suffix
                if path not in paths:
                    paths.append(path)
                if len(paths) == 2:
                    return paths
        return paths

    @lru_cache(None)
    def visit(wi, ci):
        if ci == len(chunks):
            return [()] if wi == len(pronunciations) else []
        paths = []
        maximum = len(pronunciations) - wi - (len(chunks) - ci - 1)
        for count in range(1, maximum + 1):
            # Preserve existing one-chunk word evidence; lexical scoring is checked separately.
            partitions = [(len(chunks[ci]),)] if count == 1 else split_chunk(wi, count, ci)
            for lengths in partitions:
                for suffix in visit(wi + count, ci + 1):
                    path = (lengths,) + suffix
                    if path not in paths:
                        paths.append(path)
                    if len(paths) == 2:
                        return paths
        return paths

    paths = visit(0, 0)
    if len(paths) != 1:
        return None
    result = []
    for chunk, lengths in zip(chunks, paths[0]):
        offset = 0
        for length in lengths:
            result.append(list(chunk[offset:offset + length]))
            offset += length
    if len(result) != len(pronunciations) or [p for group in result for p in group] != [p for group in chunks for p in group]:
        raise ValueError('Recovered partition changed the sentence reference')
    return result
