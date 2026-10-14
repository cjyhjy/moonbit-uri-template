"""Encode fixture text without interpreting literal backslash-u sequences."""

def quote(text):
    escapes = {'\\': '\\\\', '"': '\\"'}
    parts = []
    for char in text:
        value = ord(char)
        if 0xD800 <= value <= 0xDFFF:
            raise ValueError('Fixture contains an unpaired Unicode surrogate')
        parts.append(escapes.get(char, '\\u{%04x}' % value if value < 32 else char))
    return '"' + ''.join(parts) + '"'
