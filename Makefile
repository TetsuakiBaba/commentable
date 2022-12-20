.PHONY: all install install-electron install-web up-electron up-web
install: install-electron install-web

install-electron:
	cd commentable-electron-client; \
	npm install

install-web:
	cd commentable-web; \
	npm install

up-electron:
	cd commentable-electron-client; \
	npm start

up-web:
	cd commentable-web; \
	npm start
