"""Measure complete authored items. This program never creates item wording."""
import collections
import hashlib
import json
import re
import statistics
import unicodedata
from pathlib import Path

SOURCE = Path(__file__).resolve().parent
ROOT = next(parent for parent in SOURCE.parents if (parent / '.git').exists())
CORPUS = ROOT / 'apps/api/test/fixtures/community-text-corpus'
LANGUAGES = ('de', 'en', 'es', 'fr', 'it', 'pt', 'tr')


def canonical(text):
    return unicodedata.normalize('NFKC', text).casefold().strip()


def measure(language):
    source = SOURCE / f'{language}.tsv'
    rows = []
    for line_number, line in enumerate(source.read_text().splitlines(), 1):
        parts = line.split('\t')
        if len(parts) != 3:
            raise ValueError(f'{source.name}:{line_number}: expected three columns')
        concepts, field, text = parts
        if field not in ('caption', 'altText') or not text.strip():
            raise ValueError(f'{source.name}:{line_number}: invalid field or empty item')
        rows.append((line_number, concepts.split(','), field, text))
    history_paths = [
        CORPUS / directory / f'{other}.json'
        for directory in ('', 'holdout-v1', 'holdout-v2', 'holdout-v3')
        for other in LANGUAGES
    ]
    historical = collections.defaultdict(list)
    for old in history_paths:
        value = json.loads(old.read_text())
        for item in value.get('entries', value.get('clean', {}).get('entries', [])):
            historical[canonical(item['text'])].append(str(old.relative_to(ROOT)))
    grams = collections.defaultdict(set)
    concepts = collections.defaultdict(set)
    texts = collections.defaultdict(list)
    collisions = []
    lengths = []
    word_counts = []
    for number, labels, field, text in rows:
        value = canonical(text)
        texts[value].append(number)
        if value in historical:
            collisions.append({'item': number, 'paths': historical[value]})
        for label in labels:
            concepts[label.strip()].add(number)
        words = re.findall(r'[^\W_]+', value, re.UNICODE)
        word_counts.append(len(words))
        for start in range(len(words) - 4):
            grams[tuple(words[start:start + 5])].add(number)
        if len(text) > (200 if field == 'altText' else 280):
            lengths.append(number)
    repeated = [{'sequence': ' '.join(gram), 'items': sorted(items)}
                for gram, items in sorted(grams.items()) if len(items) > 1]
    affected = sorted(set().union(*(set(item['items']) for item in repeated)))
    ranked = sorted(concepts.items(), key=lambda entry: (-len(entry[1]), entry[0]))
    return {
        'language': language,
        'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'total': len(rows),
        'fields': dict(collections.Counter(row[2] for row in rows)),
        'fiveWordOverlap': {'affectedCount': len(affected),
                            'affectedShare': len(affected) / len(rows),
                            'affectedItems': affected, 'repeatedSequences': repeated},
        'concepts': {'distinct': len(concepts), 'maximumCount': len(ranked[0][1]),
                     'maximumShare': len(ranked[0][1]) / len(rows),
                     'groups': [{'concept': name, 'items': sorted(items)}
                                for name, items in ranked]},
        'wholeTextDuplicates': [items for items in texts.values() if len(items) > 1],
        'historicalCollisions': collisions,
        'historicalPaths': [str(old.relative_to(ROOT)) for old in history_paths],
        'overLengthItems': lengths,
        'wordCounts': {'minimum': min(word_counts), 'median': statistics.median(word_counts),
                       'maximum': max(word_counts),
                       'fewerThanFiveWords': sum(count < 5 for count in word_counts)},
        'maximumCaptionLength': max(len(row[3]) for row in rows if row[2] == 'caption'),
        'maximumAltTextLength': max((len(row[3]) for row in rows if row[2] == 'altText'), default=0),
    }


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('languages', nargs='+', choices=LANGUAGES)
    parser.add_argument('--json-directory', type=Path)
    args = parser.parse_args()
    for language in args.languages:
        result = measure(language)
        if args.json_directory:
            args.json_directory.mkdir(parents=True, exist_ok=True)
            destination = args.json_directory / f'{language}-common-audit.json'
            destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({key: result[key] for key in ('language', 'total', 'fields')},
                         ensure_ascii=False))
        print('five-word affected:', result['fiveWordOverlap']['affectedCount'],
              'largest concept:', result['concepts']['maximumCount'],
              'duplicates:', len(result['wholeTextDuplicates']),
              'historical collisions:', len(result['historicalCollisions']),
              'length violations:', len(result['overLengthItems']))
