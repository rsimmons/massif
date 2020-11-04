import unicodedata
import sys

tbl = dict.fromkeys(i for i in range(sys.maxunicode) if chr(i).isspace() or unicodedata.category(chr(i)).startswith('P') or unicodedata.category(chr(i)).startswith('S'))

def remove_spaces_punctuation(text):
    return text.translate(tbl)

def count_meaty_chars(text):
    return len(remove_spaces_punctuation(text))

if __name__ == "__main__":
    sys.stdin.reconfigure(encoding='utf-8')
    test_str = sys.stdin.read()
    print(repr(test_str))
    print(repr(remove_spaces_punctuation(test_str)))
    print(count_meaty_chars(test_str))
