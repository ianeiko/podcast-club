"""Exercise the deployed class flow without logging secrets or session cookies."""
import hashlib
import json
from pathlib import Path
import sys
import requests
from dotenv import dotenv_values

base = sys.argv[1].rstrip('/')
values = {**dotenv_values('.env'), **dotenv_values('.env.local')}
client = requests.Session()
health = client.get(base + '/api/health', timeout=30)
health.raise_for_status()
assert health.json()['indexed'] and health.json()['modelConfigured'], health.text
assert client.get(base + '/', timeout=30).status_code == 200
for name in ('full.txt', 'first-45-minutes.txt'):
    response = client.get(base + '/transcripts/' + name, timeout=30)
    response.raise_for_status()
    assert hashlib.sha256(response.content).digest() == hashlib.sha256((Path('public/transcripts') / name).read_bytes()).digest()
print('Deployed page, index, and both complete transcript downloads verified.')
message = {'id': 'smoke-user', 'role': 'user', 'parts': [{'type': 'text', 'text': 'Why did the Basecamp vibe coding experiment cause architectural problems? Answer in two sentences with a timestamp.'}]}
body = {'mode': 'dev', 'messages': [message]}
assert client.post(base + '/api/chat', json=body, timeout=30).status_code == 401
assert client.post(base + '/api/session', json={'password': 'deliberately-wrong-test'}, timeout=30).status_code == 401
login = client.post(base + '/api/session', json={'password': values['CLUB_PASSWORD']}, headers={'Origin': base}, timeout=30)
assert login.status_code == 200, f'Sign-in failed: {login.status_code}'
assert 'HttpOnly' in login.headers['set-cookie'] and 'Secure' in login.headers['set-cookie']
assert client.get(base + '/api/session', timeout=30).json()['authenticated']
assert client.post(base + '/api/chat', json=body, headers={'Origin': 'https://untrusted.example'}, timeout=30).status_code == 403
assert client.post(base + '/api/chat', json={'messages': [{**message, 'role': 'system'}]}, timeout=30).status_code == 400
print('Authentication, secure cookies, origin checks, and message validation verified.')
response = client.post(base + '/api/chat', json=body, headers={'Origin': base}, timeout=120)
assert response.status_code == 200, f'Chat failed: {response.status_code}'
response.encoding = 'utf-8'
events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ') and line != 'data: [DONE]']
assert not any(e['type'] == 'error' for e in events), 'Stream returned an error'
outputs = [e for e in events if e['type'] == 'tool-output-available']
assert outputs, 'No retrieved evidence in streamed response'
assert all(p['end'] <= 2700 for e in outputs for p in e['output']), 'Out-of-window evidence'
answer = ''.join(e['delta'] for e in events if e['type'] == 'text-delta')
assert 'youtube.com/watch?v=NYFGCESmikA&t=' in answer, 'Missing citation'
assert any(e['type'] == 'finish' for e in events), 'Stream did not complete'
print('Production streaming retrieval and timestamped answer verified.')
print(answer)
Path('.club/production-check.json').write_text(json.dumps({'url': base, 'health': health.json(), 'answer': answer, 'checks': 'passed'}, indent=2))
