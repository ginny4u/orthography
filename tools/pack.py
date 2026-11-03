# -*- coding: utf-8 -*-
# 데이터 파일을 그대로 읽히지 않게 싸서 내보낸다(복제 방지용 가벼운 난독화).
# 원본은 tools/*.py에 있고, 화면(index.html)의 ORTH_UNPACK이 풀어서 쓴다.
import json, base64

KEY = 'orth-2026-jinhee'   # index.html의 ORTH_UNPACK과 같아야 한다

def pack(obj):
    raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    k = KEY.encode('utf-8')
    out = bytes(b ^ k[i % len(k)] ^ ((i * 7) & 0xff) for i, b in enumerate(raw))
    return base64.b64encode(out).decode('ascii')

def emit(varname, obj, note=''):
    head = ('// ' + note + '\n') if note else ''
    return head + '// © 배진희(진희T). 문항과 해설의 무단 복제·배포를 금합니다.\n' + \
        'window.' + varname + ' = ORTH_UNPACK("' + pack(obj) + '");\n'
