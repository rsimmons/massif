import json
from sklearn.linear_model import LogisticRegression

# data = [
#     [0, 1],
#     [100, 1],
#     [1000, 1],
#     [5000, 1],
#     [6000, 0],
#     [7000, 1],
#     [8000, 0],
#     [19000, 0],
#     [20000, 0],
# ]
data = [
    [-1, 1],
    [2, 0],
]
xs = [(x,) for (x, _) in data]
ys = [y for (_, y) in data]

clf = LogisticRegression(C=1).fit(xs, ys)
print(clf.intercept_, clf.coef_)
