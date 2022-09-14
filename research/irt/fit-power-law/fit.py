import numpy as np
import matplotlib.pyplot as plt
from scipy.optimize import curve_fit

SKIP_FIRST = 100
RANK_LIMIT = 1000

freqs = np.loadtxt('jdrama_freq_10k.txt', dtype='float')
freqs = freqs[:RANK_LIMIT]
print(f'considering up to rank {len(freqs)}')

ranks = np.arange(0, len(freqs), dtype='int')

ranks = ranks[SKIP_FIRST:]
freqs = freqs[SKIP_FIRST:]

plt.loglog(ranks, freqs)
# plt.plot(ranks, freqs)


def power_law(x, a, b):
    return a*np.power(x, b)

pars, cov = curve_fit(f=power_law, xdata=ranks, ydata=freqs, p0=[0, 0], bounds=(-np.inf, np.inf))
stdevs = np.sqrt(np.diag(cov))
print(f'skipping first {SKIP_FIRST} ranks (irregular)')
print('freq = a*rank^b')
print(f'a = {pars[0]} ± {stdevs[0]}')
print(f'b = {pars[1]} ± {stdevs[1]}')

plt.show()
