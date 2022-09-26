import math
import random
from sklearn.linear_model import LogisticRegression

data = [
    (-1, 1),
    (1, 0),
]

PICK_PROB = 0.8

for i in range(200):
    xs = [[x] for (x, _) in data]
    ys = [y for (_, y) in data]

    clf = LogisticRegression(random_state=0, penalty='none').fit(xs, ys)

    fit_b = clf.intercept_[0]
    fit_w = clf.coef_[0][0]

    if i > 40:
        # sample at a x that should have prob of PICK_PROB according to current fit
        logit = math.log(PICK_PROB/(1-PICK_PROB))
        sim_x = (logit - fit_b)/fit_w
    else:
        sim_x = random.uniform(-1, 1)

    # find the actual probability according to our hidden truth

    # hidden truth is logistic function
    # SIM_B = 0.5
    # SIM_W = -2
    # prob = 1/(1 + math.exp(-(SIM_W*sim_x + SIM_B)))

    # hidden truth is a sqrt-scaled thing very loosely based on my data
    prob = min(max(-0.9*math.sqrt(sim_x+1) + 1.5, 0), 1)

    sim_y = int(random.random() < prob)

    data.append((sim_x, sim_y))

    print(i, fit_b, fit_w, sim_x, prob, sum(1 for [_, y] in data if y == 1)/len(data))
