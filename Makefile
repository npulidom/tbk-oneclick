.PHONY: deploy docker-build-dev

# Build ID
BUILD_ID=$(shell git log -1 --pretty=%h)

docker-build-dev:
	docker build -t npulidom/tbk-oneclick:dev --build-arg BUILD_ID="$(BUILD_ID)" --target dev .

docker-build-prod:
	docker build -t npulidom/tbk-oneclick --build-arg BUILD_ID="$(BUILD_ID)" --target prod --platform linux/amd64 .

docker-push:
	docker push npulidom/tbk-oneclick

deploy: docker-build-prod docker-push
