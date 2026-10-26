"""Copy complete authored TSV texts to the documented import format.

No program constructs or modifies wording. Editorial concept labels stay in TSV.
"""
import json
import argparse
from pathlib import Path
from audit import LANGUAGES, SOURCE, measure

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-directory', required=True, type=Path)
args = parser.parse_args()
destination = args.output_directory
destination.mkdir(parents=True, exist_ok=True)
for language in LANGUAGES:
    result = measure(language)
    assert result['total'] == 1000, language
    assert result['fields'] == {'caption': 500, 'altText': 500}, language
    assert result['fiveWordOverlap']['affectedCount'] <= 10, language
    assert result['concepts']['maximumCount'] <= 10, language
    assert not result['wholeTextDuplicates'], language
    assert not result['historicalCollisions'], language
    assert not result['overLengthItems'], language
    source = SOURCE / f'{language}.tsv'
    complete_items = []
    for line in source.read_text().splitlines():
        _concept, field, complete_text = line.split('\t')
        complete_items.append({'field': field, 'text': complete_text})
    (destination / f'holdout-{language}.json').write_text(
        json.dumps(complete_items, ensure_ascii=False, indent=2) + '\n'
    )
    print(f'{language}: copied {len(complete_items)} complete authored items unchanged')
