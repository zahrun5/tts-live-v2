#!/usr/bin/env python3
"""Bangun tools/data/id-common.txt: kata Indonesia umum dari frekuensi pemakaian (wordfreq).
Kata 3 huruf butuh frekuensi lebih tinggi karena banyak singkatan/serpihan kata asing.
Jalankan dari folder server/:  pip install wordfreq && python3 tools/build-common-words.py"""
import re, os
from wordfreq import top_n_list, zipf_frequency as z
words = sorted(w for w in top_n_list('id', 200000)
               if re.fullmatch(r'[a-z]{3,16}', w) and z(w, 'id') >= (4.5 if len(w) == 3 else 3.3))
os.makedirs('tools/data', exist_ok=True)
open('tools/data/id-common.txt', 'w').write('\n'.join(words) + '\n')
print(len(words))
