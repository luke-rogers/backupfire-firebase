.DEFAULT_GOAL := build
.PHONY: build

BIN = $(shell yarn bin)

test:
	${BIN}/jest

test-watch:
	${BIN}/jest --watch

test-lib:
	node test/lib/commonjs.js
	${BIN}/ts-node test/lib/ts.ts

# Test projects

build-test-server:
	@${BIN}/tsc test/server/index.ts --esModuleInterop --outDir test/server/build

deploy-test-server: build-test-server
	@cd test/server && ${BIN}/firebase deploy --only functions:backupfire

build-test-extension:
	@${BIN}/tsc test/extension/index.ts --esModuleInterop --outDir test/extension/build

deploy-test-extension: build-test-extension
	@cd test/extension && ${BIN}/firebase deploy 

# Staging & production

build:
	@rm -rf lib
	@${BIN}/tsc
	@${BIN}/prettier "lib/**/*.[jt]s" --write --loglevel silent
	@cp package.json lib
	@cp *.md lib
	@rsync --archive --prune-empty-dirs --exclude '*.ts' --relative src/./ lib

publish: build test-lib
	cd lib && npm publish --access public

publish-next: build
	cd lib && npm publish --access public --tag next

build-extension:
	@cd extension/functions && npm run build

publish-extension: build-extension
	@cd extension && firebase ext:dev:publish backupfire/backupfire-agent
