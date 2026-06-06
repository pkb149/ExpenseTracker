.PHONY: build check dev deploy

build:
	npm run build

check: build
	npm run check

dev: check
	wrangler pages dev dist

deploy: check
	wrangler pages deploy dist
