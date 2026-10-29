#!/usr/bin/env python3
"""Collect independently sourced weights metadata and detailed lab billing plans.

No license or serving price is inferred from a provider name. Failed sources
retain dated last-good records; consumers must disclose that status. This feed
never changes the standard price tape or frontier basket.
"""
from __future__ import annotations
import hashlib, json, re, urllib.request
from urllib.parse import quote, unquote, urlsplit
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path
try:
    from collector.collect import atomic_write_json, atomic_write_text
    from collector.official import fetch_source, visible_text, PROVIDER_URLS, PROVIDER_PUBLIC_URLS, _money_values, openai_price_rows, openai_rate
except ModuleNotFoundError:
    from collect import atomic_write_json, atomic_write_text
    from official import fetch_source, visible_text, PROVIDER_URLS, PROVIDER_PUBLIC_URLS, _money_values, openai_price_rows, openai_rate
ROOT = Path(__file__).resolve().parent.parent
PERMISSIVE = {'apache-2.0', 'mit', 'bsd-2-clause', 'bsd-3-clause', 'isc', 'cc-by-4.0', 'cc0-1.0'}
WEIGHTS_SCHEMA = 2
ANTHROPIC_BILLING_SCHEMA = 1
OPENAI_BILLING_SCHEMA = 2
PARTICLE_BILLING_SCHEMA = 1
PARTICLE_BILLING_URL = 'https://docs.particle.ai/usage-billing'
MOONSHOT_BILLING_SCHEMA = 1
MOONSHOT_BILLING_URL = 'https://platform.kimi.ai/docs/pricing/chat'
WEIGHTS_REVIEWS = json.loads((ROOT/'collector/weights-reviewed.json').read_text())['repositories']

def license_file(repository, payload):
    """Accept a card link only when it names a file in this exact repository."""
    files = {s.get('rfilename', '') for s in payload.get('siblings', []) if isinstance(s, dict)}
    card = payload.get('cardData') or {}
    link = card.get('license_link')
    if isinstance(link, str):
        parsed = urlsplit(link)
        prefix = f'/{repository}/blob/main/'
        candidate = unquote(parsed.path[len(prefix):]) if parsed.path.startswith(prefix) else ''
        if (parsed.scheme == 'https' and parsed.netloc == 'huggingface.co'
                and not parsed.query and not parsed.fragment and candidate in files
                and all(part not in ('', '.', '..') for part in candidate.split('/'))):
            return candidate
    return next((name for name in ('LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENSE-TEXT') if name in files), None)

def weights_record(repository, payload, now, license_bytes=None):
    if str(payload.get('id', '')).lower() != repository.lower():
        raise ValueError('Repository identity does not match')
    files = [s.get('rfilename', '') for s in payload.get('siblings', []) if isinstance(s, dict)]
    has_weights = any(re.search(r'\.(?:safetensors|gguf|bin)$', f) and not re.search(r'(?:optimizer|training_args|adapter)', f, re.I) for f in files)
    if not has_weights:
        raise ValueError('No model weights listed')
    tags = [t.split(':', 1)[1] for t in payload.get('tags', []) if isinstance(t, str) and t.startswith('license:')]
    license_id = tags[0] if len(tags) == 1 else 'unknown'
    card = payload.get('cardData') or {}
    filename = license_file(repository, payload)
    name = str(card.get('license_name') or license_id)
    review = WEIGHTS_REVIEWS.get(repository)
    reviewed = bool(review and review.get('licenseSha256') and review['licenseId'] == license_id and review['licenseFile'] == filename
            and license_bytes is not None and hashlib.sha256(license_bytes).hexdigest() == review['licenseSha256'])
    if reviewed:
        name = review['licenseName']
    return {'repository': repository, 'sourceUrl': f'https://huggingface.co/{repository}',
            'licenseUrl': f'https://huggingface.co/{repository}/blob/main/{quote(filename, safe="/")}' if filename else f'https://huggingface.co/{repository}',
            'license': license_id, 'licenseName': name,
            'licenseClass': 'permissive' if license_id in PERMISSIVE else 'unknown' if license_id == 'unknown' else 'custom',
            'gated': bool(payload.get('gated')), 'verifiedAt': now, 'status': 'fresh', 'weightsAvailable': True,
            'metadataSchema': WEIGHTS_SCHEMA,
            **({'reviewedLicenseSha256': review['licenseSha256']} if reviewed else {})}

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

def opus_fast_plan(text, standard):
    """Read the reviewed Opus speed option without inventing missing cache rates."""
    section = re.search(r'Fast mode pricing(.*?)(?=Batch processing|\Z)', text, re.S)
    if not section:
        return None
    body = section.group(1)
    if not re.search(r'\| Model \| Input \| Output \|', body):
        return None
    rows = re.findall(r'\| Claude Opus 5\.5 \| ([^|]+) \| ([^|]+) \|', body)
    if len(rows) != 1:
        return None
    rates = [re.fullmatch(r'\s*\$\s*(\d+(?:\.\d+)?)\s*(?:USD\s*)?/\s*MTok\s*', cell) for cell in rows[0]]
    if not all(rates):
        return None
    inp, output = (float(value.group(1)) for value in rates)
    if inp <= 0 or output <= 0 or standard['input_mtok'] <= 0:
        return None
    plan = {'id': 'fast', 'label': 'Fast', 'input_mtok': inp, 'output_mtok': output,
            'notes': 'Optional faster inference of the same Opus 5.5 model. Claude API: speed="fast"; access is available in Start, Build and Scale tiers. Also available on Azure-hosted Microsoft Foundry. No Batch or Priority Tier combination. Cache and data-residency modifiers stack on Fast rates; switching speeds invalidates the prompt cache. Cache-use assumptions must describe requests at this speed.'}
    # Derive only the cache rates present in the independently parsed Standard
    # row, and only while the source explicitly confirms the multiplier rule.
    cache_rule = re.sub(r'\[Prompt caching multipliers\]\(https://platform\.claude\.com/docs/en/about-claude/pricing#prompt-caching\)',
                        'Prompt caching multipliers', body)
    if re.search(r'Prompt caching multipliers\s*\|?\s*apply on top of fast mode pricing', cache_rule):
        multiplier = inp / standard['input_mtok']
        for field in ['cached_input_mtok', 'cache_write_mtok', 'cacheWriteHour_mtok']:
            if field in standard:
                plan[field] = round(standard[field] * multiplier, 8)
    return plan

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

def moonshot_plan(source, api_id, label='Standard'):
    """Read the published DocTable's named columns as data, without executing MDX."""
    columns = {'Input': 'input_mtok', 'Output': 'output_mtok',
               'Cached Input': 'cached_input_mtok', '5m writes': 'cache_write_mtok',
               '1h writes': 'cacheWriteHour_mtok'}
    found = []
    for table in re.finditer(r'columns:\[(.*?)\],rows:\[(.*?)\]\}\)', source, re.S):
        header = re.findall(r'(?:title|children):`([^`]+)`', table.group(1))
        if len(header) != 6 or len(set(header)) != 6 or set(header) != {'Model', *columns}:
            continue
        # Model is the link cell; the numeric columns may be reordered.
        if header[0] != 'Model': continue
        for row in re.finditer(r'\[_jsx\(_components\.a,\{[^{}]*children:`([^`]+)`\}\),(.*?)\]', table.group(2), re.S):
            if row.group(1) != api_id: continue
            cells = row.group(2).split(',')
            rates = [re.fullmatch(r'`\$([0-9]+(?:\.[0-9]+)?) / MTok`', cell.strip()) for cell in cells]
            if len(rates) != 5 or not all(rates):
                raise ValueError(f'Moonshot {api_id} billing row malformed')
            found.append({columns[name]: float(rate.group(1)) for name, rate in zip(header[1:], rates)})
    # Hydration may repeat identical data; disagreement cannot verify a price.
    unique = {json.dumps(row, sort_keys=True) for row in found}
    if len(unique) != 1: raise ValueError(f'Moonshot {api_id} billing row missing or ambiguous')
    return {'id': label.lower(), 'label': label, **json.loads(unique.pop()),
            'contextWindowTokens': 1048576,
            'notes': f'Kimi API model: {api_id}. Flat rates across the context window. Cache writes use a 5-minute TTL by default, or the selected 1-hour TTL; hits refresh that TTL without another write charge. Allocate each input token to uncached input, cache reads or cache writes once. No separate storage rate is published.'}


def particle_plans(source):
    """Verify the reviewed direct model and named rates; never inherit route rules."""
    text = source.replace('\\$', '$').replace('\\_', '_')
    section = re.search(r'^## Prices\s*\n(.*?)(?=^### Flex pricing|\Z)', text, re.S | re.M)
    if not section:
        raise ValueError('Particle pricing section missing')
    headers = None; rows = []
    expected = {'Model', 'Input (uncached)', 'Cached input', 'Output'}
    for line in section.group(1).splitlines():
        if not line.strip().startswith('|'): continue
        cells = [c.strip().strip('`') for c in line.strip().strip('|').split('|')]
        if set(cells) == expected and len(cells) == 4:
            headers = cells
        elif headers and 'particle-1' in cells:
            if len(cells) != 4 or cells[headers.index('Model')] != 'particle-1':
                raise ValueError('Particle pricing row malformed')
            rates = {}
            for column, field in [('Input (uncached)', 'input_mtok'), ('Cached input', 'cached_input_mtok'), ('Output', 'output_mtok')]:
                match = re.fullmatch(r'\$([0-9]+(?:\.[0-9]+)?)', cells[headers.index(column)])
                if not match: raise ValueError('Particle price missing or ambiguous')
                rates[field] = float(match.group(1))
            rows.append(rates)
    if len(rows) != 1:
        raise ValueError('Particle exact model row missing or duplicated')
    # Discount plans are verified independently from the standard rate row.
    clean = re.sub(r'[*`]', '', text)
    if not (re.search(r'\| Off-peak \| 20:30 [–-] 04:00 \|', clean)
            and 'America/New_York, follows DST' in clean
            and '50% of the peak defaults' in clean
            and re.search(r'### Flex pricing.*?effective.*?flex.*?50% off', clean, re.S)):
        raise ValueError('Particle scheduled/Flex discount policy changed')
    explicit = re.search(r'Off-peak defaults are.*?\$([0-9.]+) input / \$([0-9.]+) cached input / \$([0-9.]+) output on.*?particle-1', clean, re.S)
    if not explicit or any(abs(float(value) - rows[0][field] * .5) > 1e-9
            for value, field in zip(explicit.groups(), ['input_mtok', 'cached_input_mtok', 'output_mtok'])):
        raise ValueError('Particle explicit off-peak rates disagree with discount rule')
    notes = ('Particle direct API only; do not apply these rules to a routed quote. '
             'Peak: 04:00–20:30; off-peak: 20:30–04:00 America/New_York (follows DST). '
             'Choose the period for the requests being budgeted; it is selected after routing and locked for each request. '
             'Flex requires an eligible account and effective X-Particle-Service-Tier: flex; requesting it alone is insufficient. '
             'Account-specific overrides may differ. Reasoning is included in output: do not count it twice. '
             'All steering generations, including the original hidden tail, remain billable; usage: null is not zero usage. '
             'Default web search adds $0.0025 per successful search, unchanged by Flex; add tool fees separately. '
             'Cached input is the observed cache-hit portion; no cache-write/storage tariff is published.')
    return [dict(id=id, label=label, **{k:round(v*factor, 8) for k,v in rows[0].items()},
                 contextWindowTokens=1048576, maximumOutputTokens=131072, notes=notes)
            for id,label,factor in [('standard','Direct peak',1), ('off-peak','Direct off-peak',.5),
                                    ('flex','Direct peak · Flex',.5), ('off-peak-flex','Direct off-peak · Flex',.25)]]


def parse_billing(provider, source, models):
    result = {}
    if provider == 'particle-ai':
        if any(m['key'] == 'particle-ai/particle-1' for m in models):
            result['particle-ai/particle-1'] = particle_plans(source)
    elif provider == 'moonshotai':
        for model in models:
            name = model['key'].split('/', 1)[1]
            if name not in {'kimi-k3', 'kimi-k3.1-pro'}: continue
            try: standard = moonshot_plan(source, name)
            except ValueError: continue
            plans = [standard]
            if name == 'kimi-k3.1-pro':
                try: plans.append(moonshot_plan(source, 'kimi-k3.1-pro-highspeed', 'Highspeed'))
                except ValueError: pass
            result[model['key']] = plans
    elif provider == 'openai':
        names = {model['key'].split('/', 1)[1] for model in models}
        sections = {mode: openai_price_rows(source, mode, names) for mode in ['Standard', 'Batch']}
        # Terra's extra modes are explicitly reviewed; keep other model plans unchanged.
        if 'gpt-6.1-terra' in names:
            flex = re.search(r'^#### Flex\s*\n(?P<body>.*?)(?=^#### |^### |\Z)', source, re.S | re.M)
            if flex:
                sections['Flex'] = openai_price_rows('### Flex pricing data\n'+flex.group('body'), 'Flex', {'gpt-6.1-terra'})
            if re.search(r'^### Fast pricing data\s*$', source, re.M):
                sections['Fast'] = openai_price_rows(source, 'Fast', {'gpt-6.1-terra'})
        for model in models:
            name = model['key'].split('/', 1)[1]; plans = []
            for mode, rows in sections.items():
                cells = rows.get(name)
                if cells is None: continue
                # Keep exact API IDs; qualified legacy rows need a separate review.
                for prefix, label in [('Short context ', mode), ('Long context ', mode+' long context')]:
                    if prefix+'input' not in cells: continue
                    p = {'id': label.lower().replace(' ', '-'), 'label': label,
                         'input_mtok': openai_rate(cells, prefix+'input'),
                         'output_mtok': openai_rate(cells, prefix+'output')}
                    for column, field in [('cached input', 'cached_input_mtok'),
                                          ('cache writes', 'cache_write_mtok'),
                                          ('30m write', 'cacheWrite30Minute_mtok'),
                                          ('12h write', 'cacheWrite12Hour_mtok')]:
                        if prefix+column in cells and cells[prefix+column] != '-':
                            p[field] = openai_rate(cells, prefix+column)
                    if 'cacheWrite30Minute_mtok' in p or 'cacheWrite12Hour_mtok' in p:
                        p['notes'] = 'Cache writes have separate 30-minute and 12-hour rates. Select the retention duration used by your requests.'
                    if name == 'gpt-6.1-terra':
                        p['contextWindowTokens'] = 1050000
                        p['maximumOutputTokens'] = 128000
                        if prefix == 'Short context ': p['maximumPromptTokens'] = 272000
                        else: p['minimumPromptTokens'] = 272001
                        p['notes'] = (p.get('notes', '')+' Above 272,000 prompt tokens the long context rates apply to the entire request. Regional processing adds 10% where available; apply the regional multiplier separately. Tool fees are additional. Tool calling requires the Responses API. Check serving-mode availability for your account.').strip()
                    plans.append(p)
            if plans: result[model['key']] = plans
    elif provider == 'anthropic':
        text = visible_text(source); start = text.find('The following table shows pricing for all Claude models:')
        boundaries = [text.find(label, start) for label in ['Cloud platform pricing', 'Feature-specific pricing', 'Fast mode pricing', 'Batch processing']]
        end = min((position for position in boundaries if position >= 0), default=-1)
        if start < 0 or end < 0: raise ValueError('Claude pricing table missing')
        table = text[start:end]
        header = table.split(' | Claude ', 1)[0]
        reordered = bool(re.search(r'Name\s*\|\s*Input\s*\|\s*Output\s*\|\s*5m writes\s*\|\s*1h writes\s*\|\s*Hits and refreshes', header))
        if not reordered and not re.search(r'Base input tokens\s*\|\s*5m cache writes\s*\|\s*1h cache writes\s*\|\s*Cache hits and refreshes\s*\|\s*Output tokens', header):
            raise ValueError('Claude billing columns changed')
        for model in models:
            display = model['display']; pattern = rf'\|\s*{re.escape(display)}(?:\s*\([^|]*\))?\s*\|'
            matches = list(re.finditer(pattern, table)); plans = []
            for m in matches:
                nextrow = table.find(' | Claude ', m.end()); segment = table[m.start():nextrow if nextrow>=0 else len(table)]
                vals = [float(v) for v in _money_values(segment)]
                blocks = [(vals, segment)] if len(vals) == 5 else []
                # The current table puts both Haiku tariffs in one named row.
                if model['key'] == 'anthropic/claude-haiku-5.5' and len(vals) == 10:
                    money = list(re.finditer(r'\$\s*[0-9]+(?:\.[0-9]+)?\s*(?:\|\s*)*/\s*(?:\|\s*)*MTok', segment, re.I))
                    boundary = money[5].start()
                    blocks = [(vals[:5], segment[:boundary]), (vals[5:], segment[boundary:])]
                for values, block in blocks:
                    short = 'up to 100,000 tokens' in block
                    long = 'over 100,000 tokens' in block
                    if short and long: continue
                    if model['key'] == 'anthropic/claude-haiku-5.5' and not (short or long): continue
                    name = 'Standard long context' if long else 'Standard'
                    inp, output, write, hour, hit = values if reordered else [values[0], values[4], values[1], values[2], values[3]]
                    p = tier(name, [inp, hit, write, output], cacheWriteHour_mtok=hour)
                    if p:
                        if long: p['minimumPromptTokens'] = 100001
                        elif short: p['maximumPromptTokens'] = 100000
                        plans.append(p)
            if len({p['id'] for p in plans}) != len(plans): plans = []
            plans.sort(key=lambda p: p['id'] != 'standard')
            # Batch plus cache is supported by Claude; multipliers stack.
            if plans and '50% discount on both input and output tokens' in text and 'Prompt caching and batch processing discounts apply' in text:
                for p in list(plans):
                    b = dict(p); b['id'] = p['id'].replace('standard','batch'); b['label'] = p['label'].replace('Standard','Batch')
                    for f in ['input_mtok','output_mtok','cached_input_mtok','cache_write_mtok','cacheWriteHour_mtok']:
                        if f in b: b[f] *= .5
                    plans.append(b)
            # Fast is a serving option, never a successor or a discounted Batch
            # variant. Only this explicitly reviewed model is eligible.
            if model['key'] == 'anthropic/claude-opus-5.5' and plans:
                fast = opus_fast_plan(text, plans[0])
                if fast: plans.append(fast)
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
        review = WEIGHTS_REVIEWS.get(repo)
        needs_review = bool(review and review.get('licenseSha256') and
                            (previous or {}).get('reviewedLicenseSha256') != review['licenseSha256'])
        if previous and previous.get('metadataSchema') == WEIGHTS_SCHEMA and age(previous)<timedelta(days=1) and not needs_review:return repo,previous
        try:
            request=urllib.request.Request('https://huggingface.co/api/models/'+repo,headers={'User-Agent':'MarginalToken/1.0'})
            with urllib.request.urlopen(request,timeout=12) as r:payload=json.loads(r.read(4*1024*1024))
            license_bytes = None
            review = WEIGHTS_REVIEWS.get(repo)
            filename = license_file(repo, payload)
            revision = payload.get('sha', '')
            if review and review.get('licenseSha256') and filename == review['licenseFile'] and re.fullmatch(r'[0-9a-f]{40}', revision):
                request = urllib.request.Request(f'https://huggingface.co/{repo}/raw/{revision}/{quote(filename, safe="/")}', headers={'User-Agent':'MarginalToken/1.0'})
                with urllib.request.urlopen(request,timeout=12) as r:license_bytes=r.read(256*1024)
            return repo,weights_record(repo,payload,stamp,license_bytes)
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
        needs_fast = (provider == 'anthropic' and any(m['key'] == 'anthropic/claude-opus-5.5' for m in models)
                      and ((previous or {}).get('parserSchema') != ANTHROPIC_BILLING_SCHEMA
                           or not any(p['id'] == 'fast' for p in (previous or {}).get('plans', {}).get('anthropic/claude-opus-5.5', []))))
        required_openai = {m['key'] for m in models if m['provider'] == 'openai' and m.get('source') == 'firstparty'}
        needs_openai = provider == 'openai' and ((previous or {}).get('parserSchema') != OPENAI_BILLING_SCHEMA
                          or bool(required_openai - set((previous or {}).get('plans', {}))))
        if previous and age(previous)<timedelta(hours=24) and not needs_argon and not needs_fast and not needs_openai:entry=previous
        else:
            try:
                source=fetch_source(PROVIDER_URLS[provider]).text
                entries=parse_billing(provider,source,[m for m in models if m['provider']==provider])
                if not entries:raise ValueError('No billing plans parsed')
                entry={'plans':entries,'sourceUrl':PROVIDER_PUBLIC_URLS.get(provider,PROVIDER_URLS[provider]),'verifiedAt':stamp,'status':'fresh'}
                if provider == 'anthropic':entry['parserSchema'] = ANTHROPIC_BILLING_SCHEMA
                if provider == 'openai':entry['parserSchema'] = OPENAI_BILLING_SCHEMA
            except Exception:
                entry={**previous,'status':'stale' if age(previous)>timedelta(days=7) else 'last_good'} if previous else None
        if entry:
            cache['billing'][provider]=entry
            for key,plans in entry['plans'].items():billing[key]={'plans':plans,**{k:entry[k] for k in ['sourceUrl','verifiedAt','status']}}
    # Moonshot's new billing adapter retains freshness independently per model.
    wanted = [m for m in models if m['key'] in {'moonshotai/kimi-k3', 'moonshotai/kimi-k3.1-pro'}]
    if wanted:
        previous = cache['billing'].get('moonshotai', {})
        entries = previous.get('models', {}) if previous.get('parserSchema') == MOONSHOT_BILLING_SCHEMA else {}
        due = [m for m in wanted if m['key'] not in entries or age(entries[m['key']]) >= timedelta(hours=24)]
        if due:
            # Mintlify's negotiated Markdown omits this custom DocTable.
            # Its HTML response includes the actual named columns and rates.
            try: parsed = parse_billing('moonshotai', fetch_source(MOONSHOT_BILLING_URL, accept='text/html').text or '', due)
            except Exception: parsed = {}
            for model in due:
                key = model['key']
                if key in parsed:
                    entries[key] = {'plans': parsed[key], 'sourceUrl': MOONSHOT_BILLING_URL,
                                    'verifiedAt': stamp, 'status': 'fresh'}
                elif key in entries:
                    entries[key] = {**entries[key], 'status': 'stale' if age(entries[key]) > timedelta(days=7) else 'last_good'}
        cache['billing']['moonshotai'] = {'parserSchema': MOONSHOT_BILLING_SCHEMA, 'models': entries}
        billing.update({m['key']: entries[m['key']] for m in wanted if m['key'] in entries})
    # Direct Particle billing is separate from OpenRouter's Tape/venue quote.
    particle_key = 'particle-ai/particle-1'
    if any(m['key'] == particle_key for m in models):
        previous = cache['billing'].get('particle-ai')
        if (previous and previous.get('parserSchema') == PARTICLE_BILLING_SCHEMA
                and age(previous) < timedelta(hours=24)):
            entry = previous
        else:
            try:
                parsed = parse_billing('particle-ai', fetch_source(PARTICLE_BILLING_URL).text or '',
                                       [{'key': particle_key}])
                entry = {'plans': parsed[particle_key], 'sourceUrl': PARTICLE_BILLING_URL,
                         'verifiedAt': stamp, 'status': 'fresh', 'parserSchema': PARTICLE_BILLING_SCHEMA}
            except Exception:
                entry = {**previous, 'status': 'stale' if age(previous) > timedelta(days=7) else 'last_good'} if previous else None
        if entry:
            cache['billing']['particle-ai'] = entry
            billing[particle_key] = {k:v for k,v in entry.items() if k != 'parserSchema'}
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
