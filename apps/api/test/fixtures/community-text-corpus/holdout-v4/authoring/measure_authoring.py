from pathlib import Path
from collections import Counter, defaultdict
import json, unicodedata, hashlib, sys
root = Path('/tmp/cc68-tea-holdout-v4')
historical_root = root / 'apps/api/test/fixtures/community-text-corpus'

def normalize(text):
    return unicodedata.normalize('NFKC', text).casefold()

def words(text):
    out, current = [], []
    for char in normalize(text):
        if unicodedata.category(char)[0] in {'L', 'N'}:
            current.append(char)
        elif current:
            out.append(''.join(current)); current = []
    if current: out.append(''.join(current))
    return out

def texts(value):
    if isinstance(value, dict):
        for key, child in value.items():
            if key == 'text' and isinstance(child, str): yield child
            else: yield from texts(child)
    elif isinstance(value, list):
        for child in value: yield from texts(child)

historical = defaultdict(list)
historical_locales = ('de', 'en', 'es', 'fr', 'it', 'pt', 'tr')
historical_files = [historical_root / f'{locale}.json' for locale in historical_locales]
for version in ('holdout-v1', 'holdout-v2', 'holdout-v3'):
    historical_files.extend(historical_root / version / f'{locale}.json' for locale in historical_locales)
for source in historical_files:
    for text in texts(json.loads(source.read_text())):
        historical[normalize(text)].append(str(source.relative_to(historical_root)))

for locale in sys.argv[1:]:
    source = root / '.cc68-tea-authoring' / f'{locale}.tsv'
    rows = [line.split('\t') for line in source.read_text().splitlines()]
    assert all(len(row) == 3 for row in rows)
    grams, concepts, complete = defaultdict(set), Counter(), defaultdict(list)
    issues = []
    for number, (labels, field, text) in enumerate(rows, 1):
        limit = 280 if field == 'caption' else 200
        if field not in {'caption', 'altText'} or len(text) > limit:
            issues.append({'row': number, 'field': field, 'length': len(text)})
        for label in labels.split(','): concepts[label] += 1
        complete[normalize(text)].append(number)
        tokenized = words(text)
        for start in range(len(tokenized) - 4):
            grams[tuple(tokenized[start:start + 5])].add(number)
    shared = {gram: sorted(ids) for gram, ids in grams.items() if len(ids) > 1}
    affected = sorted({number for ids in shared.values() for number in ids})
    report = {
        'locale': locale, 'author': '/root/general_review',
        'rows': len(rows), 'fieldCounts': dict(Counter(row[1] for row in rows)),
        'conceptCount': len(concepts), 'maxConceptItems': max(concepts.values(), default=0),
        'fiveWordAffectedCount': len(affected), 'fiveWordAffectedRows': affected,
        'sharedFiveWordSequences': [{'text': ' '.join(key), 'rows': value} for key,value in shared.items()],
        'historicalCompleteTextMatches': [
            {'rows': ids, 'sources': historical[text]}
            for text, ids in complete.items() if text in historical
        ],
        'duplicateCompleteTexts': [ids for ids in complete.values() if len(ids)>1],
        'fieldOrLengthIssues': issues,
        'maxCaptionLength': max((len(row[2]) for row in rows if row[1]=='caption'), default=0),
        'maxAltTextLength': max((len(row[2]) for row in rows if row[1]=='altText'), default=0),
        'historicalJsonFilesChecked': len(historical_files),
        'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
