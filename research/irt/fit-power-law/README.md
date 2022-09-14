I was curious to test how well some Japanese word frequency data fit Zip's law, and it turned out to fit quite well.

I did a power law regression and for word ranks 101-1000 I got (normalized) freq = a*rank^b with a = 0.1979 and b = -1.070. The exponent is close to the -1 predicted by the simplest form of Zipf's law. The fit is a little less good if I include lower/higher ranks but still pretty good.
