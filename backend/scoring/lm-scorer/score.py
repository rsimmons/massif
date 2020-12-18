import argparse

import torch
from lm_scorer.models.auto import AutoLMScorer as LMScorer

# 'gpt2', 'gpt2-medium', 'gpt2-large', 'gpt2-xl', 'distilgpt2'
MODELS = ['gpt2', 'gpt2-medium', 'gpt2-large']

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('sentence_file')
    parser.add_argument('source_name')
    args = parser.parse_args()

    sents = []
    sent_chars = {}
    sent_words = {}
    with open(args.sentence_file, encoding='utf-8') as f:
        for line in f:
            sline = line.strip()
            if sline.startswith('#'):
                continue
            if not sline:
                continue
            sent = sline.split('#')[0]
            sents.append(sent)

            chars = len(sent)
            words = len(sent.split())

            sent_chars[sent] = chars
            sent_words[sent] = words

            db.record_stat(sent, args.source_name, 'chars', chars)
            db.record_stat(sent, args.source_name, 'words', words)

    device = 'cuda:0' if torch.cuda.is_available() else 'cpu'
    print('using device', device)

    for model in MODELS:
        print('loading model', model, '...')
        scorer = LMScorer.from_pretrained(model, device=device, batch_size=1)

        scores = []
        charss = []
        wordss = []
        for sent in sents:
            score = scorer.sentence_score(sent, log=True)
            print(score, sent)

            scores.append(score)

            db.record_stats(sent, args.source_name, {
                f'lm-{model}': score,
                f'lm-{model}-div-chars': score/sent_chars[sent],
                f'lm-{model}-div-words': score/sent_words[sent],
            })

        score_div_lens = [s/l for (s, l) in zip(scores, charss)]
        if args.plot:
            plot(sents, [sent_chars[s] for s in sents], score_div_lens)
