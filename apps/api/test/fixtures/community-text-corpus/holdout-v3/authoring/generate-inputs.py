"""Compose predeclared, blinded v3 text. This script never imports a screener."""

import argparse
import hashlib
import itertools
import json
import unicodedata
from pathlib import Path


LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'pt', 'tr']


def canonical(text):
    return unicodedata.normalize('NFKC', text).casefold().strip()


def load_banks(file):
    banks = {}
    section = None
    for line in file.read_text().splitlines():
        if line.startswith('[') and line.endswith(']'):
            section = line[1:-1]
            banks[section] = []
        elif line.strip():
            assert section is not None
            banks[section].append(line.strip())
    expected = {'outfits': 50, 'moments': 30, 'captionEndings': 20,
                'backgrounds': 30, 'light': 20}
    assert {name: len(rows) for name, rows in banks.items()} == expected
    assert all(len(row.split('|')) == 2 for row in banks['outfits'])
    for rows in banks.values():
        assert len(rows) == len(set(rows))
    return banks


def prior_texts(corpus, language):
    existing = json.loads((corpus / f'{language}.json').read_text())
    texts = [row['text'] for row in existing['clean']['entries']]
    for version in ['holdout-v1', 'holdout-v2']:
        previous = json.loads((corpus / version / f'{language}.json').read_text())
        texts.extend(row['text'] for row in previous['entries'])
    return {canonical(text) for text in texts}


def compose(language, banks, seed, excluded):
    entries = []
    used = set()

    def rank(value):
        return hashlib.sha256(f'{seed}\0{language}\0{value}'.encode()).hexdigest()

    for field in ['caption', 'altText']:
        limit = 280 if field == 'caption' else 200
        for outfit_index, pair in enumerate(banks['outfits']):
            caption, alt = pair.split('|')
            first = banks['moments'] if field == 'caption' else banks['backgrounds']
            last = banks['captionEndings'] if field == 'caption' else banks['light']
            candidates = []
            for a, b in itertools.product(range(len(first)), range(len(last))):
                text = (f'{first[a]} {caption} {last[b]}' if field == 'caption'
                        else f'{alt} {first[a]} {last[b]}')
                normal = canonical(text)
                if (len(text) <= limit and
                        len(text.encode('utf-16-le')) // 2 <= limit and
                        normal not in excluded and normal not in used):
                    key = f'{field}:{outfit_index}:{a}:{b}'
                    candidates.append((rank(key), text, normal))
            candidates.sort()
            assert len(candidates) >= 10, (language, field, outfit_index)
            selected = candidates[:10]
            assert len({row[2] for row in selected}) == 10
            for _, text, normal in selected:
                used.add(normal)
                entries.append({'field': field, 'text': text})
    assert len(entries) == len(used) == 1000
    assert sum(row['field'] == 'caption' for row in entries) == 500
    assert sum(row['field'] == 'altText' for row in entries) == 500
    return sorted(entries, key=lambda row: rank(row['field'] + '\0' + row['text']))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    plan = json.loads((source / 'authoring-plan.json').read_text())
    corpus = args.root / 'apps/api/test/fixtures/community-text-corpus'
    args.output.mkdir(parents=True, exist_ok=True)
    for language in LANGUAGES:
        target = args.output / f'holdout-{language}.json'
        assert not target.exists(), 'Import inputs are write-once'
        entries = compose(language, load_banks(source / f'{language}.txt'),
                          plan['seed'], prior_texts(corpus, language))
        target.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n')
        print(f'{language}: 1000 inputs; 500 captions, 500 alt texts; structural checks pass')


if __name__ == '__main__':
    main()
