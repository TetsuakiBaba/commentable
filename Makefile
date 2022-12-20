.PHONY: all install install-electron install-web up-electron up-web
install: install-electron install-web

install-electron:
	cd client; \
	npm install

install-web:
	cd web; \
	npm install

up-electron:
	cd client; \
	npm start

up-web:
	cd web; \
	npm start
