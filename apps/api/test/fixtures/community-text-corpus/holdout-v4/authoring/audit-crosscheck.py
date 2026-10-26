"""Independently check five-word membership with Unicode category scanning."""
import collections
import json
import unicodedata
from audit import LANGUAGES, SOURCE, measure

summary = {}
for language in LANGUAGES:
    rows = [line.split('\t') for line in
            (SOURCE / f'{language}.tsv').read_text().splitlines()]
    owners = collections.defaultdict(set)
    for number, (_labels, _field, text) in enumerate(rows, 1):
        normalized = unicodedata.normalize('NFKC', text).casefold()
        words, pending = [], []
        for character in normalized:
            if unicodedata.category(character)[0] in ('L', 'N'):
                pending.append(character)
            elif pending:
                words.append(''.join(pending))
                pending = []
        if pending:
            words.append(''.join(pending))
        for sequence in zip(words, words[1:], words[2:], words[3:], words[4:]):
            owners[sequence].add(number)
    affected = set().union(*(ids for ids in owners.values() if len(ids) > 1))
    common = measure(language)
    assert sorted(affected) == common['fiveWordOverlap']['affectedItems'], language
    summary[language] = {'affectedItems': sorted(affected), 'agrees': True}
print(json.dumps(summary, ensure_ascii=False, indent=2))
