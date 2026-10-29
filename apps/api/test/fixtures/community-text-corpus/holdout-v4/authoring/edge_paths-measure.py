from pathlib import Path
from collections import Counter,defaultdict
import re,unicodedata,json,hashlib
base=Path('/tmp/cc68-tea-holdout-v4'); folder=base/'.cc68-tea-authoring'; root=base/'apps/api/test/fixtures/community-text-corpus'
locales=['de','en','es','fr','it','pt','tr']
paths=[root/f'{l}.json' for l in locales]+[root/f'holdout-v{v}'/f'{l}.json' for v in [1,2,3] for l in locales]
def norm(t):return unicodedata.normalize('NFKC',t).casefold()
def extract(x):
 if isinstance(x,dict):
  for k,v in x.items():
   if k in ('text','caption','altText') and isinstance(v,str):yield v
   else:yield from extract(v)
 elif isinstance(x,list):
  for v in x:yield from extract(v)
history={norm(t) for p in paths for t in extract(json.loads(p.read_text()))}
gloss={
'geraffte-schulterpasse':'Gathered blouse fabric falling from a shoulder yoke.',
'sichtbares-kontrastfutter':'Showing contrasting patterned lining by opening or folding a garment or bag.',
'umgeschlagener-stiefelschaft':'A boot shaft folded outward into a cuff.',
'gerundetes-hosenbein':'A curved or barrel-shaped trouser leg silhouette.',
'sichtbarer-zierunterkragen':'A decorative inner collar peeking above an outer neckline.',
'transparentes-ueberkleid':'A transparent outer dress layered above an opaque underdress.',
'textile-bluetenverzierung':'Three-dimensional fabric flowers used as wearable decoration.',
'florale-handstickerei':'Small hand-embroidered flowers or leaves on otherwise plain clothing.',
'gestuetzte-rockglocke':'A supported bell-shaped skirt volume.',
'ruecken-bewegungsfalte':'A back pleat providing extra movement through the shoulders.',
'gehaekelter-zierkragenrand':'A decorative crocheted collar or neckline edge.',
'cierre-acordonado':'Garment edges joined by crossing tie cords.',
'reparacion-visible-jersey':'Visible repair of a worn or damaged knitted sweater.',
'ribete-contrastado':'Contrasting trim outlining the garment edges.',
'volantes-finos-delanteros':'Fine ruffles arranged on the front of a blouse or shirt.',
'capas-blusa-transparentes':'A transparent blouse layer revealing an opaque inner top.',
'superposicion-falda-plana':'Flat skirt panels overlapping at different lengths.',
'linea-vertical-calceteria':'A visible vertical contrasting line on hosiery.',
'reverso-contrastado-visible':'A contrasting reverse surface revealed by folding or opening clothing.',
'panel-superior-superpuesto':'A short outer panel layered over the upper back or shoulders.',
'degisen-yogunluklu-atki':'A scarf with intentionally different weave or knit density along its length.',
'halka-ile-kemer-kapatma':'A belt secured by passing it through one or more rings.',
'sabitlemeli-omuz-sali':'A shoulder shawl held in place with a fastening.',
'dugumlu-tekstil-kolye':'A necklace whose visual focus is knotted textile cord.',
'kucuk-ponpon-susleme':'Small yarn pompons applied as clothing decoration.',
'el-yapimi-seramik-taki':'Handmade glazed ceramic jewelry with a tactile surface.',
'acik-sirt-baglama':'Open garment back panels held together with ties.',
'disarida-gorunen-yapi-dikisi':'Exterior stitching showing the construction lines of a garment.',
'oya-kenar-susleme':'Fine decorative needle-lace trim along a wearable edge.',
'sarkan-aksesuar-puskulu':'A dangling bundled tassel attached to an accessory.',
'yuvarlak-etek-cebi':'Rounded skirt pockets or curved skirt-pocket entrances.',
'giysi-asma-ilmegi':'A sewn hanging loop used to support a garment on a hook.',
'kravat-gorunumlu-bel-bagi':'A waist tie arranged with the visual form of a necktie.',
'kemerde-kucuk-canta':'A small pouch or bag attached directly to a waist belt.',
'festelbiseyi-gundeliklestirme':'Wearing a special-occasion dress casually with everyday flat footwear.'}
report={'author_identity':'/root/edge_paths','author_role':'cc68-tea independent v4 corpus author','authorship_method':'Individually composed complete literal TSV rows. No fragment banks, combinatorial text, scripted text generation, or scripted model calls. Helpers serialize or measure complete authored items and concept labels.','inspection':'Only the explicit 28 historical locale JSON files were read for text disjointness. No repair, policy, screener, development corpus or evaluation inspection during authorship.','historical_files':[{'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths],'locales':{}}
for l in ['de','es','tr']:
 p=folder/f'{l}.tsv'; raw=p.read_text().splitlines(); rows=[s.split('\t') for s in raw];issues=[]
 for i,a in enumerate(rows,1):
  if len(a)!=3:issues.append({'row':i,'issue':'column count'});continue
  if a[1] not in ['caption','altText']:issues.append({'row':i,'issue':'field'})
  if len(a[2])>(280 if a[1]=='caption' else 200):issues.append({'row':i,'issue':'length'})
 c=Counter(a[1] for a in rows);labels=defaultdict(list);grams=defaultdict(set)
 for i,a in enumerate(rows,1):
  for label in a[0].split(','):labels[label].append(i)
  w=re.findall(r'[^\W_]+',norm(a[2]))
  for j in range(len(w)-4):grams[tuple(w[j:j+5])].add(i)
 bad={k:v for k,v in grams.items() if len(v)>1};affected=set().union(*bad.values()) if bad else set();m=max(map(len,labels.values()));top=[]
 for k,v in sorted(labels.items()):
  if len(v)==m:
   assert k in gloss,(l,k)
   top.append({'concept':k,'english_gloss':gloss[k],'count':len(v),'rows':v,'membership':[{'row':i,'field':rows[i-1][1]} for i in v]})
 report['locales'][l]={'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'authored_range':f'{l} TSV rows 1..{len(rows)}','full_count':len(rows),'fields':dict(c),'max_characters':{f:max(len(a[2]) for a in rows if a[1]==f) for f in c},'consolidated_concepts':len(labels),'largest_concept':m,'tied_maximum_concepts':top,'five_word_affected_items':len(affected),'five_word_overlaps':[{'words':list(k),'rows':sorted(v)} for k,v in bad.items()],'normalized_duplicate_count':len(rows)-len({norm(a[2]) for a in rows}),'historical_collisions':[i for i,a in enumerate(rows,1) if norm(a[2]) in history],'structural_issues':issues}
(folder/'edge_paths-final-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for l,a in report['locales'].items():
 print(l,a['sha256'],a['full_count'],a['fields'],'concepts',a['consolidated_concepts'],'largest',a['largest_concept'],'fivegrams',a['five_word_affected_items'],'duplicates',a['normalized_duplicate_count'],'history',len(a['historical_collisions']),'issues',a['structural_issues'])
 print('overlaps',a['five_word_overlaps'])
