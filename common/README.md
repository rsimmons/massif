# Common

Common Python code that needs to be shared between `backend` and `web` goes here.

It's a bit awkward, but I don't see an easier way than just symlinking to `common` from wherever needs it. This means that any other modules that symlink to this will need to (redundantly) include dependencies in their own `requirements.txt`. Annoying, but it works for now.
