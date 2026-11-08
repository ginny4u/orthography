# -*- coding: utf-8 -*-
# 데이터 파일(data.js·school.js·spot.js·pairs.js) 주소에 버전표(?v=내용 해시)를 붙인다.
# 브라우저가 옛 파일을 재사용하지 않게 하려고. 데이터를 다시 만들 때마다 자동으로 돈다.
import hashlib, re, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def run():
    p = os.path.join(ROOT, 'index.html')
    s = open(p, encoding='utf-8').read()
    for f in ('data.js', 'school.js', 'spot.js', 'pairs.js'):
        h = hashlib.sha1(open(os.path.join(ROOT, f), 'rb').read()).hexdigest()[:8]
        s = re.sub(r'src="%s(\?v=[0-9a-f]+)?"' % re.escape(f), 'src="%s?v=%s"' % (f, h), s)
    open(p, 'w', encoding='utf-8').write(s)

if __name__ == '__main__':
    run()
