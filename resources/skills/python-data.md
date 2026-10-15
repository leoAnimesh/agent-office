---
name: Python data work
description: pandas, notebooks and data pipelines
tags: data, python, pandas
---
- Load data with explicit dtypes and parse dates on read.
- Prefer vectorised pandas or NumPy operations to Python loops.
- Never change the raw input data; write results to new files or tables.
- Check shapes, null counts and value ranges after each step that changes them.
- Put reusable logic in `.py` modules, not only in notebooks, and test it.
- Pin library versions in the project's requirements file.
- Make runs reproducible: fixed random seeds and documented input files.
