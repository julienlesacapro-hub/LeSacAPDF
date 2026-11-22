"""Profil ICC sRGB version 2.1 (matrice + courbes), généré à partir des valeurs
publiques de la norme IEC 61966-2-1 (primaires adaptées D50). Aucune donnée tierce."""
import struct, base64
def s15(v): return struct.pack('>i', int(round(v * 65536)))
def xyz(x, y, z): return b'XYZ ' + b'\0'*4 + s15(x) + s15(y) + s15(z)
def curv():
    n = 1024; vals = []
    for i in range(n):
        c = i / (n - 1)
        l = c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
        vals.append(int(round(l * 65535)))
    return b'curv' + b'\0'*4 + struct.pack('>I', n) + b''.join(struct.pack('>H', v) for v in vals)
def desc(t):
    a = t.encode('ascii') + b'\0'
    return b'desc' + b'\0'*4 + struct.pack('>I', len(a)) + a + b'\0'*4 + b'\0'*4 + b'\0'*2 + b'\0' + b'\0'*67
def text(t): return b'text' + b'\0'*4 + t.encode('ascii') + b'\0'
tags = [(b'desc', desc('sRGB IEC61966-2.1')), (b'cprt', text('No copyright, use freely')),
        (b'wtpt', xyz(0.9642, 1.0, 0.8249)), (b'rXYZ', xyz(0.4361, 0.2225, 0.0139)),
        (b'gXYZ', xyz(0.3851, 0.7169, 0.0971)), (b'bXYZ', xyz(0.1431, 0.0606, 0.7141))]
trc = curv(); tags += [(b'rTRC', trc), (b'gTRC', trc), (b'bTRC', trc)]
table, data, off = b'', b'', 128 + 4 + 12 * len(tags)
shared = {}
for sig, d in tags:
    while len(d) % 4: d += b'\0'
    if d in shared: o = shared[d]
    else:
        o = off + len(data); shared[d] = o; data += d
    table += sig + struct.pack('>II', o, len(d))
body = struct.pack('>I', len(tags)) + table + data
size = 128 + len(body)
hdr = (struct.pack('>I', size) + b'lcms' + bytes([2, 0x10, 0, 0]) + b'mntr' + b'RGB ' + b'XYZ ' + b'\0'*12 + b'acsp' +
       b'\0'*4 + b'\0'*4 + b'\0'*4 + b'\0'*4 + b'\0'*8 + struct.pack('>I', 0) + s15(0.9642) + s15(1.0) + s15(0.8249) + b'\0'*4 + b'\0'*16 + b'\0'*28)
assert len(hdr) == 128, len(hdr)
icc = hdr + body
open('srgb-v2.icc', 'wb').write(icc)
open('srgb-v2.b64', 'w').write(base64.b64encode(icc).decode())
print(len(icc))
