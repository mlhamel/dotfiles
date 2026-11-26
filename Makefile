# Local parity with the test job in .github/workflows/lint.yml.
# Run `make` to list targets (default), `make test` to run the full suite.

.DEFAULT_GOAL := help

.PHONY: help test

help:
	@echo 'Targets:'
	@echo '  make test   run the full suite: node tests (plugins, eval, profiles) + shell suite'

test:
	node --test test/plugins/*.test.js
	node --test test/eval/*.test.js
	node --test test/profiles/*.test.js
	bash test/shell/run.sh
