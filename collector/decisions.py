#!/usr/bin/env python3
"""Collect independently sourced weights metadata and detailed lab billing plans.

No license or serving price is inferred from a provider name. Failed sources
retain dated last-good records; consumers must disclose that status. This feed
never changes the standard price tape or frontier basket.
"""
from __future__ import annotations
import json, re, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path
try:
    from collector.collect import atomic_write_json, atomic_write_text
    from collector.official import fetch_source, visible_text, PROVIDER_URLS, PROVIDER_PUBLIC_URLS, _money_values
except ModuleNotFoundError:
    from collect import atomic_write_json, atomic_write_text
    from official import fetch_source, visible_text, PROVIDER_URLS, PROVIDER_PUBLIC_URLS, _money_values
ROOT = Path(__file__).resolve().parent.parent
PERMISSIVE = {'apache-2.0', 'mit', 'bsd-2-clause', 'bsd-3-clause', 'isc', 'cc-by-4.0', 'cc0-1.0'}

def weights_record(repository, payload, now):
    if str(payload.get('id', '')).lower() != repository.lower():
        raise ValueError('Repository identity does not match')
    files = [s.get('rfilename', '') for s in payload.get('siblings', []) if isinstance(s, dict)]
    has_weights = any(re.search(r'\.(?:safetensors|gguf|bin)$', f) and not re.search(r'(?:optimizer|training_args|adapter)', f, re.I) for f in files)
    if not has_weights:
        raise ValueError('No model weights listed')
    tags = [t.split(':', 1)[1] for t in payload.get('tags', []) if isinstance(t, str) and t.startswith('license:')]
    license_id = tags[0] if len(tags) == 1 else 'unknown'
    card = payload.get('cardData') or {}
    return {'repository': repository, 'sourceUrl': f'https://huggingface.co/{repository}',
            'licenseUrl': f'https://huggingface.co/{repository}/blob/main/LICENSE' if 'LICENSE' in files else f'https://huggingface.co/{repository}',
            'license': license_id, 'licenseName': str(card.get('license_name') or license_id),
            'licenseClass': 'permissive' if license_id in PERMISSIVE else 'unknown' if license_id == 'unknown' else 'custom',
            'gated': bool(payload.get('gated')), 'verifiedAt': now, 'status': 'fresh', 'weightsAvailable': True}

def prices(cells):
    result = []
    for c in cells:
        m = re.search(r'\$\s*(\d+(?:\.\d+)?)', c)
        result.append(float(m.group(1)) if m else None)
    return result

def tier(label, vals, **extra):
    if len(vals) < 4 or vals[0] is None or vals[3] is None:
        return None
    result = {'id': label.lower().replace(' ', '-'), 'label': label, 'input_mtok': vals[0], 'output_mtok': vals[3], **extra}
    for field, value in [('cached_input_mtok', vals[1]), ('cache_write_mtok', vals[2])]:
        if value is not None: result[field] = value
    return result

def argon_billing(segment):
    """Read Argon's dated tariffs without treating a future rate as a context tier."""
    date_pattern = r'([A-Z][a-z]+ \d{1,2}, \d{4})'
    def dated_rates(cell):
        plain = re.findall(r'\$\s*([0-9]+(?:\.[0-9]+)?)', cell)
        if len(plain) == 1 and not re.search(r'through|starting', cell):
            return {'current': (float(plain[0]), None)}
        matches = re.findall(r'\$([0-9.]+)\s+(through|starting)\s+' + date_pattern, cell)
        if len(matches) != 2 or len(plain) != 2:
            raise ValueError('Argon dated price is missing or ambiguous')
        rates = {kind: (float(value), datetime.strptime(date, '%B %d, %Y').date())
                 for value, kind, date in matches}
        if set(rates) != {'through', 'starting'} or rates['starting'][1] != rates['through'][1] + timedelta(days=1):
            raise ValueError('Argon price dates do not form consecutive periods')
        return rates
    plans = []
    for mode in ['Standard', 'Batch', 'Flex', 'Priority']:
        match = re.search(rf'\| {mode} \|(?P<body>.*?)(?=\| (?:Standard|Batch|Flex|Priority) \||\Z)', segment, re.S)
        if not match: raise ValueError(f'Argon {mode} billing section missing')
        body = match.group('body')
        inp = re.search(r'Input price(.*?)Output price', body, re.S)
        output = re.search(r'Output price \(including thinking tokens\)(.*?)Context caching price', body, re.S)
        cache = re.search(r'Context caching price(.*?)(?:Grounding|Used to improve)', body, re.S)
        if not inp or not output or not cache or 'Implicit caching only (explicit caching is not supported)' not in cache.group(1):
            raise ValueError(f'Argon {mode} billing columns or cache policy changed')
        rates = [dated_rates(cell.group(1)) for cell in [inp, output, cache]]
        metadata = {'id': mode.lower(), 'label': mode, 'cacheMode': 'implicit',
                    'minimumCachePromptTokens': 4096, 'contextWindowTokens': 1048576, 'maximumOutputTokens': 65536,
                    'notes': 'Implicit cache hits only; explicit cache writes and storage are unsupported. Thinking is billed as output. Calculator uses the 65,536-token synchronous output limit; input and generated tokens share the 1,048,576-token window.'}
        fields = ['input_mtok', 'output_mtok', 'cached_input_mtok']
        if all('current' in r for r in rates):
            plans.append({**metadata, **{field: r['current'][0] for field, r in zip(fields, rates)}})
            continue
        if any('current' in r for r in rates):
            raise ValueError('Argon mixes dated and undated price columns')
        if any(r['through'][1] != rates[0]['through'][1] or r['starting'][1] != rates[0]['starting'][1] for r in rates):
            raise ValueError('Argon input, output and cache dates disagree')
        current = {field: r['through'][0] for field, r in zip(fields, rates)}
        future = {field: r['starting'][0] for field, r in zip(fields, rates)}
        plans.append({**metadata, **current,
                      'validThrough': rates[0]['through'][1].isoformat(),
                      'scheduledRates': [{'effectiveFrom': rates[0]['starting'][1].isoformat(), **future}]})
    return plans

def parse_billing(provider, source, models):
    result = {}
    if provider == 'openai':
        expected_header = '| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |'
        if expected_header not in source: raise ValueError('OpenAI billing columns changed')
        sections = {}
        for mode, marker in [('Standard', 'Standard'), ('Batch', 'Batch')]:
            m = re.search(rf'### {marker} pricing data\s*(.*?)(?=\n### |\Z)', source, re.S)
            if not m: continue
            rows = {}
            for line in m.group(1).splitlines():
                cells = [c.strip() for c in line.strip().strip('|').split('|')]
                if len(cells) == 9 and cells[0] not in ('Model', '---'):
                    name = re.sub(r'\s*\(.*', '', cells[0]); rows[name] = prices(cells[1:])
            sections[mode] = rows
        for model in models:
            name = model['key'].split('/', 1)[1]; plans = []
            for mode, rows in sections.items():
                if name not in rows: continue
                vals = rows[name]
                for label, vs in [(mode, vals[:4]), (mode+' long context', vals[4:])]:
                    p = tier(label, vs)
                    if p: plans.append(p)
            if plans: result[model['key']] = plans
    elif provider == 'anthropic':
        text = visible_text(source); start = text.find('The following table shows pricing for all Claude models:')
        end = text.find('Batch processing', start)
        if start < 0 or end < 0: raise ValueError('Claude pricing table missing')
        table = text[start:end]
        if not re.search(r'Base input tokens\s*\|\s*5m cache writes\s*\|\s*1h cache writes\s*\|\s*Cache hits and refreshes\s*\|\s*Output tokens', table):
            raise ValueError('Claude billing columns changed')
        for model in models:
            display = model['display']; pattern = rf'\|\s*{re.escape(display)}(?:\s*\([^|]*\))?\s*\|'
            matches = list(re.finditer(pattern, table)); plans = []
            for i,m in enumerate(matches):
                nextrow = table.find(' | Claude ', m.end()); segment = table[m.start():nextrow if nextrow>=0 else len(table)]
                vals = [float(v) for v in _money_values(segment)]
                if len(vals) != 5: continue
                name = 'Standard' if i == 0 else 'Standard long context'
                p = tier(name, [vals[0], vals[3], vals[1], vals[4]], cacheWriteHour_mtok=vals[2])
                if p:
                    if 'over 100,000 tokens' in segment: p['minimumPromptTokens'] = 100001
                    elif 'up to 100,000 tokens' in segment: p['maximumPromptTokens'] = 100000
                    plans.append(p)
            # Batch plus cache is supported by Claude; multipliers stack.
            if plans and '50% discount on both input and output tokens' in text and 'Prompt caching and batch processing discounts apply' in text:
                for p in list(plans):
                    b = dict(p); b['id'] = p['id'].replace('standard','batch'); b['label'] = p['label'].replace('Standard','Batch')
                    for f in ['input_mtok','output_mtok','cached_input_mtok','cache_write_mtok','cacheWriteHour_mtok']:
                        if f in b: b[f] *= .5
                    plans.append(b)
            if plans: result[model['key']] = plans
    elif provider == 'google':
        text = visible_text(source)
        for model in models:
            name = model['key'].split('/',1)[1]; display = model['display']
            m = re.search(rf'{re.escape(display)}\s*\|\s*{re.escape(name)}\b', text)
            if not m: continue
            segment = text[m.start():m.start()+9000]
            offset = m.end() - m.start()
            end = re.search(r'\| (?:Gemini [^|]+|Gemma [^|]+|Imagen [^|]+) \| (?:gemini|gemma|imagen)-[^\s|]+ \|',segment[offset:])
            if end: segment = segment[:end.start()+offset]
            if name == 'gemini-4-argon':
                result[model['key']] = argon_billing(segment)
                continue
            plans=[]
            for mode in ['Standard','Batch']:
                m = re.search(rf'\| {mode} \|(?P<body>.*?)(?=\| (?:Batch|Flex|Priority|Gemini [\d]) \||\Z)',segment,re.S)
                if not m: continue
                body=m.group('body')
                inp=re.search(r'Input price(.*?)Output price',body,re.S)
                output=re.search(r'Output price(?: \(including thinking tokens\))?(.*?)(?:Context caching price|Grounding|Used to improve)',body,re.S)
                cache=re.search(r'Context caching price(.*?)(?:Grounding|Used to improve)',body,re.S)
                if not inp or not output: continue
                iv=prices(re.findall(r'\$[0-9.]+',inp.group(1)));ov=prices(re.findall(r'\$[0-9.]+',output.group(1)))
                cv=prices(re.findall(r'\$[0-9.]+',cache.group(1))) if cache else []
                # Multimodal or future-effective rows need a dedicated parser.
                if len(iv) not in (1,2) or len(ov)!=len(iv) or re.search(r'audio|starting',inp.group(1)+output.group(1),re.I): continue
                for i in range(len(iv)):
                    p=tier(mode+(' long context' if i else ''),[iv[i],cv[i] if len(cv)>i else None,None,ov[i]])
                    if p:
                        if len(iv)==2:
                            if '200k' not in body: continue
                            p['minimumPromptTokens']=200001 if i else 0
                            if not i:p['maximumPromptTokens']=200000
                        storage=re.search(r'\$([0-9.]+) / 1,000,000 tokens per hour',cache.group(1) if cache else '')
                        if storage:p['cache_storage_mtok_hour']=float(storage.group(1))
                        plans.append(p)
            if plans:result[model['key']]=plans
    return result

def collect(root=ROOT, now=None):
    current=now or datetime.now(timezone.utc); stamp=current.strftime('%Y-%m-%dT%H:%M:%SZ')
    state=root/'collector/state'; target=root/'data/decisions.json'; cachefile=state/'decisions-cache.json'
    prices_feed=json.loads((root/'data/prices.json').read_text()); models=prices_feed['models']
    cache=json.loads(cachefile.read_text()) if cachefile.exists() else {'weights':{},'billing':{}}
    old=json.loads(target.read_text()) if target.exists() else None
    def age(record):
        try:return current-datetime.fromisoformat(record['verifiedAt'].replace('Z','+00:00'))
        except (KeyError,ValueError):return timedelta(days=999)
    repositories=sorted({m['huggingFaceId'] for m in models if isinstance(m.get('huggingFaceId'),str) and re.fullmatch(r'[\w.-]+/[\w.-]+',m['huggingFaceId'])})
    def get_weights(repo):
        previous=cache['weights'].get(repo)
        if previous and age(previous)<timedelta(days=1):return repo,previous
        try:
            request=urllib.request.Request('https://huggingface.co/api/models/'+repo,headers={'User-Agent':'MarginalToken/1.0'})
            with urllib.request.urlopen(request,timeout=12) as r:payload=json.loads(r.read(4*1024*1024))
            return repo,weights_record(repo,payload,stamp)
        except Exception:
            if previous:return repo,{**previous,'status':'stale' if age(previous)>timedelta(days=7) else 'last_good'}
            return repo,None
    with ThreadPoolExecutor(max_workers=8) as pool:
        weights={r:v for r,v in pool.map(get_weights,repositories) if v}
    cache['weights']=weights
    billing={}
    for provider in ['anthropic','openai','google']:
        previous=cache['billing'].get(provider)
        # A newly reviewed model or parser revision must not wait out a cache
        # containing no billing record for it.
        required = {'google/gemini-4-argon'} & {m['key'] for m in models}
        needs_argon = provider == 'google' and bool(required - set((previous or {}).get('plans', {})))
        if previous and age(previous)<timedelta(hours=24) and not needs_argon:entry=previous
        else:
            try:
                source=fetch_source(PROVIDER_URLS[provider]).text
                entries=parse_billing(provider,source,[m for m in models if m['provider']==provider])
                if not entries:raise ValueError('No billing plans parsed')
                entry={'plans':entries,'sourceUrl':PROVIDER_PUBLIC_URLS.get(provider,PROVIDER_URLS[provider]),'verifiedAt':stamp,'status':'fresh'}
            except Exception:
                entry={**previous,'status':'stale' if age(previous)>timedelta(days=7) else 'last_good'} if previous else None
        if entry:
            cache['billing'][provider]=entry
            for key,plans in entry['plans'].items():billing[key]={'plans':plans,**{k:entry[k] for k in ['sourceUrl','verifiedAt','status']}}
    records=[]
    for m in models:
        row={'key':m['key']}
        if m.get('huggingFaceId') in weights:row['weights']=weights[m['huggingFaceId']]
        if m['key'] in billing:row['billing']=billing[m['key']]
        if len(row)>1:records.append(row)
    feed={'version':1,'generatedAt':stamp,'asOf':current.strftime('%Y-%m-%d'),'models':records}
    atomic_write_json(cachefile,cache)
    if not old or old.get('models')!=records:
        atomic_write_json(target,feed);atomic_write_text(state/'publish-pending',stamp+'\n')
    print(f'Decision details: {sum("weights" in r for r in records)} weights records, {len(billing)} billing records')
if __name__=='__main__':collect()
