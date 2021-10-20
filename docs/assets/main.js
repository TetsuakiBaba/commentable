/* Carrd Site JS | carrd.co | License: MIT */

(function() {

	var	on = addEventListener,
		$ = function(q) { return document.querySelector(q) },
		$$ = function(q) { return document.querySelectorAll(q) },
		$body = document.body,
		$inner = $('.inner'),
		client = (function() {
	
			var o = {
					browser: 'other',
					browserVersion: 0,
					os: 'other',
					osVersion: 0,
					mobile: false,
					canUse: null
				},
				ua = navigator.userAgent,
				a, i;
	
			// browser, browserVersion.
				a = [
					['firefox',		/Firefox\/([0-9\.]+)/],
					['edge',		/Edge\/([0-9\.]+)/],
					['safari',		/Version\/([0-9\.]+).+Safari/],
					['chrome',		/Chrome\/([0-9\.]+)/],
					['chrome',		/CriOS\/([0-9\.]+)/],
					['ie',			/Trident\/.+rv:([0-9]+)/]
				];
	
				for (i=0; i < a.length; i++) {
	
					if (ua.match(a[i][1])) {
	
						o.browser = a[i][0];
						o.browserVersion = parseFloat(RegExp.$1);
	
						break;
	
					}
	
				}
	
			// os, osVersion.
				a = [
					['ios',			/([0-9_]+) like Mac OS X/,			function(v) { return v.replace('_', '.').replace('_', ''); }],
					['ios',			/CPU like Mac OS X/,				function(v) { return 0 }],
					['ios',			/iPad; CPU/,						function(v) { return 0 }],
					['android',		/Android ([0-9\.]+)/,				null],
					['mac',			/Macintosh.+Mac OS X ([0-9_]+)/,	function(v) { return v.replace('_', '.').replace('_', ''); }],
					['windows',		/Windows NT ([0-9\.]+)/,			null],
					['undefined',	/Undefined/,						null],
				];
	
				for (i=0; i < a.length; i++) {
	
					if (ua.match(a[i][1])) {
	
						o.os = a[i][0];
						o.osVersion = parseFloat( a[i][2] ? (a[i][2])(RegExp.$1) : RegExp.$1 );
	
						break;
	
					}
	
				}
	
				// Hack: Detect iPads running iPadOS.
					if (o.os == 'mac'
					&&	('ontouchstart' in window)
					&&	(
	
						// 12.9"
							(screen.width == 1024 && screen.height == 1366)
						// 10.2"
							||	(screen.width == 834 && screen.height == 1112)
						// 9.7"
							||	(screen.width == 810 && screen.height == 1080)
						// Legacy
							||	(screen.width == 768 && screen.height == 1024)
	
					))
						o.os = 'ios';
	
			// mobile.
				o.mobile = (o.os == 'android' || o.os == 'ios');
	
			// canUse.
				var _canUse = document.createElement('div');
	
				o.canUse = function(p) {
	
					var e = _canUse.style,
						up = p.charAt(0).toUpperCase() + p.slice(1);
	
					return	(
								p in e
							||	('Moz' + up) in e
							||	('Webkit' + up) in e
							||	('O' + up) in e
							||	('ms' + up) in e
					);
	
				};
	
			return o;
	
		}()),
		trigger = function(t) {
	
			if (client.browser == 'ie') {
	
				var e = document.createEvent('Event');
				e.initEvent(t, false, true);
				dispatchEvent(e);
	
			}
			else
				dispatchEvent(new Event(t));
	
		},
		cssRules = function(selectorText) {
	
			var ss = document.styleSheets,
				a = [],
				f = function(s) {
	
					var r = s.cssRules,
						i;
	
					for (i=0; i < r.length; i++) {
	
						if (r[i] instanceof CSSMediaRule && matchMedia(r[i].conditionText).matches)
							(f)(r[i]);
						else if (r[i] instanceof CSSStyleRule && r[i].selectorText == selectorText)
							a.push(r[i]);
	
					}
	
				},
				x, i;
	
			for (i=0; i < ss.length; i++)
				f(ss[i]);
	
			return a;
	
		},
		thisHash = function() {
	
			var h = location.hash ? location.hash.substring(1) : null,
				a;
	
			// Null? Bail.
				if (!h)
					return null;
	
			// Query string? Move before hash.
				if (h.match(/\?/)) {
	
					// Split from hash.
						a = h.split('?');
						h = a[0];
	
					// Update hash.
						history.replaceState(undefined, undefined, '#' + h);
	
					// Update search.
						window.location.search = a[1];
	
				}
	
			// Prefix with "x" if not a letter.
				if (h.length > 0
				&&	!h.match(/^[a-zA-Z]/))
					h = 'x' + h;
	
			// Convert to lowercase.
				if (typeof h == 'string')
					h = h.toLowerCase();
	
			return h;
	
		},
		scrollToElement = function(e, style, duration) {
	
			var y, cy, dy,
				start, easing, offset, f;
	
			// Element.
	
				// No element? Assume top of page.
					if (!e)
						y = 0;
	
				// Otherwise ...
					else {
	
						offset = (e.dataset.scrollOffset ? parseInt(e.dataset.scrollOffset) : 0) * parseFloat(getComputedStyle(document.documentElement).fontSize);
	
						switch (e.dataset.scrollBehavior ? e.dataset.scrollBehavior : 'default') {
	
							case 'default':
							default:
	
								y = e.offsetTop + offset;
	
								break;
	
							case 'center':
	
								if (e.offsetHeight < window.innerHeight)
									y = e.offsetTop - ((window.innerHeight - e.offsetHeight) / 2) + offset;
								else
									y = e.offsetTop - offset;
	
								break;
	
							case 'previous':
	
								if (e.previousElementSibling)
									y = e.previousElementSibling.offsetTop + e.previousElementSibling.offsetHeight + offset;
								else
									y = e.offsetTop + offset;
	
								break;
	
						}
	
					}
	
			// Style.
				if (!style)
					style = 'smooth';
	
			// Duration.
				if (!duration)
					duration = 750;
	
			// Instant? Just scroll.
				if (style == 'instant') {
	
					window.scrollTo(0, y);
					return;
	
				}
	
			// Get start, current Y.
				start = Date.now();
				cy = window.scrollY;
				dy = y - cy;
	
			// Set easing.
				switch (style) {
	
					case 'linear':
						easing = function (t) { return t };
						break;
	
					case 'smooth':
						easing = function (t) { return t<.5 ? 4*t*t*t : (t-1)*(2*t-2)*(2*t-2)+1 };
						break;
	
				}
	
			// Scroll.
				f = function() {
	
					var t = Date.now() - start;
	
					// Hit duration? Scroll to y and finish.
						if (t >= duration)
							window.scroll(0, y);
	
					// Otherwise ...
						else {
	
							// Scroll.
								window.scroll(0, cy + (dy * easing(t / duration)));
	
							// Repeat.
								requestAnimationFrame(f);
	
						}
	
				};
	
				f();
	
		},
		scrollToTop = function() {
	
			// Scroll to top.
				scrollToElement(null);
	
		},
		loadElements = function(parent) {
	
			var a, e, x, i;
	
			// IFRAMEs.
	
				// Get list of unloaded IFRAMEs.
					a = parent.querySelectorAll('iframe[data-src]:not([data-src=""])');
	
				// Step through list.
					for (i=0; i < a.length; i++) {
	
						// Load.
							a[i].src = a[i].dataset.src;
	
						// Mark as loaded.
							a[i].dataset.src = "";
	
					}
	
			// Video.
	
				// Get list of videos (autoplay).
					a = parent.querySelectorAll('video[autoplay]');
	
				// Step through list.
					for (i=0; i < a.length; i++) {
	
						// Play if paused.
							if (a[i].paused)
								a[i].play();
	
					}
	
			// Autofocus.
	
				// Get first element with data-autofocus attribute.
					e = parent.querySelector('[data-autofocus="1"]');
	
				// Determine type.
					x = e ? e.tagName : null;
	
					switch (x) {
	
						case 'FORM':
	
							// Get first input.
								e = e.querySelector('.field input, .field select, .field textarea');
	
							// Found? Focus.
								if (e)
									e.focus();
	
							break;
	
						default:
							break;
	
					}
	
		},
		unloadElements = function(parent) {
	
			var a, e, x, i;
	
			// IFRAMEs.
	
				// Get list of loaded IFRAMEs.
					a = parent.querySelectorAll('iframe[data-src=""]');
	
				// Step through list.
					for (i=0; i < a.length; i++) {
	
						// Don't unload? Skip.
							if (a[i].dataset.srcUnload === '0')
								continue;
	
						// Mark as unloaded.
							a[i].dataset.src = a[i].src;
	
						// Unload.
							a[i].src = '';
	
					}
	
			// Video.
	
				// Get list of videos.
					a = parent.querySelectorAll('video');
	
				// Step through list.
					for (i=0; i < a.length; i++) {
	
						// Pause if playing.
							if (!a[i].paused)
								a[i].pause();
	
					}
	
			// Autofocus.
	
				// Get focused element.
					e = $(':focus');
	
				// Found? Blur.
					if (e)
						e.blur();
	
	
		};
	
		// Expose scrollToElement.
			window._scrollToTop = scrollToTop;
	
	// "On Load" animation.
		on('load', function() {
			setTimeout(function() {
				$body.className = $body.className.replace(/\bis-loading\b/, 'is-playing');
	
				setTimeout(function() {
					$body.className = $body.className.replace(/\bis-playing\b/, 'is-ready');
				}, 1000);
			}, 100);
		});
	
	// Load elements (if needed).
		loadElements(document.body);
	
	// Scroll points.
		(function() {
	
			// Override exposed scrollToTop.
				window._scrollToTop = function() {
	
					// Scroll to top.
						scrollToElement(null);
	
					// Scroll point active?
						if (window.location.hash) {
	
							// Reset hash (via new state).
								history.pushState(null, null, '.');
	
						}
	
				};
	
			// Initialize.
	
				// Set scroll restoration to manual.
					if ('scrollRestoration' in history)
						history.scrollRestoration = 'manual';
	
				// Load event.
					on('load', function() {
	
						var initialScrollPoint, h;
	
						// Determine target.
							h = thisHash();
	
							// Contains invalid characters? Might be a third-party hashbang, so ignore it.
								if (h
								&&	!h.match(/^[a-zA-Z0-9\-]+$/))
									h = null;
	
							// Scroll point.
								initialScrollPoint = $('[data-scroll-id="' + h + '"]');
	
						// Scroll to scroll point (if applicable).
							if (initialScrollPoint)
								scrollToElement(initialScrollPoint, 'instant');
	
					});
	
			// Hashchange event.
				on('hashchange', function(event) {
	
					var scrollPoint, h, pos;
	
					// Determine target.
						h = thisHash();
	
						// Contains invalid characters? Might be a third-party hashbang, so ignore it.
							if (h
							&&	!h.match(/^[a-zA-Z0-9\-]+$/))
								return false;
	
						// Scroll point.
							scrollPoint = $('[data-scroll-id="' + h + '"]');
	
					// Scroll to scroll point (if applicable).
						if (scrollPoint)
							scrollToElement(scrollPoint);
	
					// Otherwise, just scroll to top.
						else
							scrollToElement(null);
	
					// Bail.
						return false;
	
				});
	
				// Hack: Allow hashchange to trigger on click even if the target's href matches the current hash.
					on('click', function(event) {
	
						var t = event.target,
							tagName = t.tagName.toUpperCase();
	
						// Find real target.
							switch (tagName) {
	
								case 'IMG':
								case 'SVG':
								case 'USE':
								case 'U':
								case 'STRONG':
								case 'EM':
								case 'CODE':
								case 'S':
								case 'MARK':
								case 'SPAN':
	
									// Find ancestor anchor tag.
										while ( !!(t = t.parentElement) )
											if (t.tagName == 'A')
												break;
	
									// Not found? Bail.
										if (!t)
											return;
	
									break;
	
								default:
									break;
	
							}
	
						// Target is an anchor *and* its href is a hash that matches the current hash?
							if (t.tagName == 'A'
							&&	t.getAttribute('href').substr(0, 1) == '#'
							&&	t.hash == window.location.hash) {
	
								// Prevent default.
									event.preventDefault();
	
								// Replace state with '#'.
									history.replaceState(undefined, undefined, '#');
	
								// Replace location with target hash.
									location.replace(t.hash);
	
							}
	
					});
	
		})();
	
	// Browser hacks.
	
		// Init.
			var style, sheet, rule;
	
			// Create <style> element.
				style = document.createElement('style');
				style.appendChild(document.createTextNode(''));
				document.head.appendChild(style);
	
			// Get sheet.
				sheet = style.sheet;
	
		// Mobile.
			if (client.mobile) {
	
				// Prevent overscrolling on Safari/other mobile browsers.
				// 'vh' units don't factor in the heights of various browser UI elements so our page ends up being
				// a lot taller than it needs to be (resulting in overscroll and issues with vertical centering).
					(function() {
	
						var f = function() {
							document.documentElement.style.setProperty('--viewport-height', window.innerHeight + 'px');
							document.documentElement.style.setProperty('--background-height', (window.innerHeight + 250) + 'px');
						};
	
						on('load', f);
						on('resize', f);
						on('orientationchange', function() {
	
							// Update after brief delay.
								setTimeout(function() {
									(f)();
								}, 100);
	
						});
	
					})();
	
			}
	
		// Android.
			if (client.os == 'android') {
	
				// Prevent background "jump" when address bar shrinks.
				// Specifically, this fix forces the background pseudoelement to a fixed height based on the physical
				// screen size instead of relying on "vh" (which is subject to change when the scrollbar shrinks/grows).
					(function() {
	
						// Insert and get rule.
							sheet.insertRule('body::after { }', 0);
							rule = sheet.cssRules[0];
	
						// Event.
							var f = function() {
								rule.style.cssText = 'height: ' + (Math.max(screen.width, screen.height)) + 'px';
							};
	
							on('load', f);
							on('orientationchange', f);
							on('touchmove', f);
	
					})();
	
				// Apply "is-touch" class to body.
					$body.classList.add('is-touch');
	
			}
	
		// iOS.
			else if (client.os == 'ios') {
	
				// <=11: Prevent white bar below background when address bar shrinks.
				// For some reason, simply forcing GPU acceleration on the background pseudoelement fixes this.
					if (client.osVersion <= 11)
						(function() {
	
							// Insert and get rule.
								sheet.insertRule('body::after { }', 0);
								rule = sheet.cssRules[0];
	
							// Set rule.
								rule.style.cssText = '-webkit-transform: scale(1.0)';
	
						})();
	
				// <=11: Prevent white bar below background when form inputs are focused.
				// Fixed-position elements seem to lose their fixed-ness when this happens, which is a problem
				// because our backgrounds fall into this category.
					if (client.osVersion <= 11)
						(function() {
	
							// Insert and get rule.
								sheet.insertRule('body.ios-focus-fix::before { }', 0);
								rule = sheet.cssRules[0];
	
							// Set rule.
								rule.style.cssText = 'height: calc(100% + 60px)';
	
							// Add event listeners.
								on('focus', function(event) {
									$body.classList.add('ios-focus-fix');
								}, true);
	
								on('blur', function(event) {
									$body.classList.remove('ios-focus-fix');
								}, true);
	
						})();
	
				// Apply "is-touch" class to body.
					$body.classList.add('is-touch');
	
			}
	
		// IE.
			else if (client.browser == 'ie') {
	
				// Element.matches polyfill.
					if (!('matches' in Element.prototype))
						Element.prototype.matches = (Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector);
	
				// Background fix.
				// IE doesn't consistently render background images applied to body:before so as a workaround
				// we can simply apply it directly to the body tag.
					(function() {
	
						var a = cssRules('body::before'),
							r;
	
						// Has a background?
							if (a.length > 0) {
	
								r = a[0];
	
								if (r.style.width.match('calc')) {
	
									// Force repaint.
										r.style.opacity = 0.9999;
	
										setTimeout(function() {
											r.style.opacity = 1;
										}, 100);
	
								}
								else {
	
									// Override body:before rule.
										document.styleSheets[0].addRule('body::before', 'content: none !important;');
	
									// Copy over background styles.
										$body.style.backgroundImage = r.style.backgroundImage.replace('url("images/', 'url("assets/images/');
										$body.style.backgroundPosition = r.style.backgroundPosition;
										$body.style.backgroundRepeat = r.style.backgroundRepeat;
										$body.style.backgroundColor = r.style.backgroundColor;
										$body.style.backgroundAttachment = 'fixed';
										$body.style.backgroundSize = r.style.backgroundSize;
	
								}
	
							}
	
					})();
	
				// Flexbox workaround.
				// IE's flexbox implementation doesn't work when 'min-height' is used, so we can work around this
				// by switching to 'height' but simulating the behavior of 'min-height' via JS.
					(function() {
						var t, f;
	
						// Handler function.
							f = function() {
	
								var mh, h, s, xx, x, i;
	
								// Wrapper.
									x = $('#wrapper');
	
									x.style.height = 'auto';
	
									if (x.scrollHeight <= innerHeight)
										x.style.height = '100vh';
	
								// Containers with full modifier.
									xx = $$('.container.full');
	
									for (i=0; i < xx.length; i++) {
	
										x = xx[i];
										s = getComputedStyle(x);
	
										// Get min-height.
											x.style.minHeight = '';
											x.style.height = '';
	
											mh = s.minHeight;
	
										// Get height.
											x.style.minHeight = 0;
											x.style.height = '';
	
											h = s.height;
	
										// Zero min-height? Do nothing.
											if (mh == 0)
												continue;
	
										// Set height.
											x.style.height = (h > mh ? 'auto' : mh);
	
									}
	
							};
	
						// Do an initial call of the handler.
							(f)();
	
						// Add event listeners.
							on('resize', function() {
	
								clearTimeout(t);
	
								t = setTimeout(f, 250);
	
							});
	
							on('load', f);
	
					})();
	
			}
	
		// Edge.
			else if (client.browser == 'edge') {
	
				// Columned container fix.
				// Edge seems to miscalculate column widths in some instances resulting in a nasty wrapping bug.
				// Workaround = left-offset the last column in each columned container by -1px.
					(function() {
	
						var xx = $$('.container > .inner > div:last-child'),
							x, y, i;
	
						// Step through last columns.
							for(i=0; i < xx.length; i++) {
	
								x = xx[i];
								y = getComputedStyle(x.parentNode);
	
								// Parent container not columned? Skip.
									if (y.display != 'flex'
									&&	y.display != 'inline-flex')
										continue;
	
								// Offset by -1px.
									x.style.marginLeft = '-1px';
	
							}
	
					})();
	
			}
	
		// Object-fit polyfill.
			if (!client.canUse('object-fit')) {
	
				// Image.
					(function() {
	
						var xx = $$('.image[data-position]'),
							x, w, c, i, src;
	
						for (i=0; i < xx.length; i++) {
	
							// Element, img.
								x = xx[i];
								c = x.firstElementChild;
	
								// Not an IMG? Strip off wrapper.
									if (c.tagName != 'IMG') {
	
										w = c;
										c = c.firstElementChild;
	
									}
	
							// Get src.
								if (c.parentNode.classList.contains('deferred')) {
	
									c.parentNode.classList.remove('deferred');
									src = c.getAttribute('data-src');
									c.removeAttribute('data-src');
	
								}
								else
									src = c.getAttribute('src');
	
							// Set src as element background.
								c.style['backgroundImage'] = 'url(\'' + src + '\')';
								c.style['backgroundSize'] = 'cover';
								c.style['backgroundPosition'] = x.dataset.position;
								c.style['backgroundRepeat'] = 'no-repeat';
	
							// Clear src.
								c.src = 'data:image/svg+xml;charset=utf8,' + escape('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"></svg>');
	
							// Hack: Fix "full column" elements (columned containers only).
								if (x.classList.contains('full')
								&&	(x.parentNode && x.parentNode.classList.contains('full'))
								&&	(x.parentNode.parentNode && x.parentNode.parentNode.parentNode && x.parentNode.parentNode.parentNode.classList.contains('container'))
								&&	x.parentNode.children.length == 1) {
	
									(function(x, w) {
	
										var	p = x.parentNode.parentNode,
											f = function() {
	
												// Set height to zero.
													x.style['height'] = '0px';
	
												// Clear timeout.
													clearTimeout(t);
	
												// Update after a short delay.
													t = setTimeout(function() {
	
														// Container inner is in "row" mode? Set fixed height.
															if (getComputedStyle(p).flexDirection == 'row') {
	
																// Wrapper (if it exists).
																	if (w)
																		w.style['height'] = '100%';
	
																// Element.
																	x.style['height'] = (p.scrollHeight + 1) + 'px';
	
															}
	
														// Otherwise, revert to auto height ...
															else {
	
																// Wrapper (if it exists).
																	if (w)
																		w.style['height'] = 'auto';
	
																// Element.
																	x.style['height'] = 'auto';
	
															}
	
													}, 125);
	
											},
											t;
	
										// Call handler on resize, load.
											on('resize', f);
											on('load', f);
	
										// Initial call.
											(f)();
	
									})(x, w);
	
								}
	
						}
	
					})();
	
				// Gallery.
					(function() {
	
						var xx = $$('.gallery img'),
							x, p, i, src;
	
						for (i=0;i < xx.length; i++) {
	
							// Img, parent.
								x = xx[i];
								p = x.parentNode;
	
							// Get src.
								if (p.classList.contains('deferred')) {
	
									p.classList.remove('deferred');
									src = x.getAttribute('data-src');
	
								}
								else
									src = x.getAttribute('src');
	
							// Set src as parent background.
								p.style['backgroundImage'] = 'url(\'' + src + '\')';
								p.style['backgroundSize'] = 'cover';
								p.style['backgroundPosition'] = 'center';
								p.style['backgroundRepeat'] = 'no-repeat';
	
							// Hide img.
								x.style['opacity'] = '0';
	
						}
	
					})();
	
			}
	
	// Scroll events.
		var scrollEvents = {
	
			/**
			 * Items.
			 * @var {array}
			 */
			items: [],
	
			/**
			 * Adds an event.
			 * @param {object} o Options.
			 */
			add: function(o) {
	
				this.items.push({
					element: o.element,
					enter: ('enter' in o ? o.enter : null),
					leave: ('leave' in o ? o.leave : null),
					mode: ('mode' in o ? o.mode : 1),
					offset: ('offset' in o ? o.offset : 0),
					state: false,
				});
	
			},
	
			/**
			 * Handler.
			 */
			handler: function() {
	
				var	height, top, bottom, scrollPad;
	
				// Determine values.
					if (client.os == 'ios') {
	
						height = document.documentElement.clientHeight;
						top = document.body.scrollTop + window.scrollY;
						bottom = top + height;
						scrollPad = 125;
	
					}
					else {
	
						height = document.documentElement.clientHeight;
						top = document.documentElement.scrollTop;
						bottom = top + height;
						scrollPad = 0;
	
					}
	
				// Step through items.
					scrollEvents.items.forEach(function(item) {
	
						var bcr, elementTop, elementBottom, state, a, b;
	
						// No enter/leave handlers? Bail.
							if (!item.enter
							&&	!item.leave)
								return true;
	
						// Not visible? Bail.
							if (item.element.offsetParent === null)
								return true;
	
						// Get element position.
							bcr = item.element.getBoundingClientRect();
							elementTop = top + Math.floor(bcr.top);
							elementBottom = elementTop + bcr.height;
	
						// Determine state.
							switch (item.mode) {
	
								// Element falls within viewport.
									case 1:
									default:
	
										// State.
											state = (bottom > (elementTop - item.offset) && top < (elementBottom + item.offset));
	
										break;
	
								// Viewport midpoint falls within element.
									case 2:
	
										// Midpoint.
											a = (top + (height * 0.5));
	
										// State.
											state = (a > (elementTop - item.offset) && a < (elementBottom + item.offset));
	
										break;
	
								// Viewport midsection falls within element.
									case 3:
	
										// Upper limit (25%-).
											a = top + (height * 0.25);
	
											if (a - (height * 0.375) <= 0)
												a = 0;
	
										// Lower limit (-75%).
											b = top + (height * 0.75);
	
											if (b + (height * 0.375) >= document.body.scrollHeight - scrollPad)
												b = document.body.scrollHeight + scrollPad;
	
										// State.
											state = (b > (elementTop - item.offset) && a < (elementBottom + item.offset));
	
										break;
	
							}
	
						// State changed?
							if (state != item.state) {
	
								// Update state.
									item.state = state;
	
								// Call handler.
									if (item.state) {
	
										// Enter handler exists?
											if (item.enter) {
	
												// Call it.
													(item.enter).apply(item.element);
	
												// No leave handler? Unbind enter handler (so we don't check this element again).
													if (!item.leave)
														item.enter = null;
	
											}
	
									}
									else {
	
										// Leave handler exists?
											if (item.leave) {
	
												// Call it.
													(item.leave).apply(item.element);
	
												// No enter handler? Unbind leave handler (so we don't check this element again).
													if (!item.enter)
														item.leave = null;
	
											}
	
									}
	
							}
	
					});
	
			},
	
			/**
			 * Initializes scroll events.
			 */
			init: function() {
	
				// Bind handler to events.
					on('load', this.handler);
					on('resize', this.handler);
					on('scroll', this.handler);
	
				// Do initial handler call.
					(this.handler)();
	
			}
		};
	
		// Initialize.
			scrollEvents.init();
	
	// Deferred.
		(function() {
	
			var items = $$('.deferred'),
				loadHandler, enterHandler;
	
			// Polyfill: NodeList.forEach()
				if (!('forEach' in NodeList.prototype))
					NodeList.prototype.forEach = Array.prototype.forEach;
	
			// Handlers.
				loadHandler = function() {
	
					var i = this,
						p = this.parentElement;
	
					// Not "done" yet? Bail.
						if (i.dataset.src !== 'done')
							return;
	
					// Show image.
						if (Date.now() - i._startLoad < 375) {
	
							p.classList.remove('loading');
							p.style.backgroundImage = 'none';
							i.style.transition = '';
							i.style.opacity = 1;
	
						}
						else {
	
							p.classList.remove('loading');
							i.style.opacity = 1;
	
							setTimeout(function() {
								i.style.backgroundImage = 'none';
							}, 375);
	
						}
	
				};
	
				enterHandler = function() {
	
					var	i = this,
						p = this.parentElement,
						src;
	
					// Get src, mark as "done".
						src = i.dataset.src;
						i.dataset.src = 'done';
	
					// Mark parent as loading.
						p.classList.add('loading');
	
					// Swap placeholder for real image src.
						i._startLoad = Date.now();
						i.src = src;
	
				};
	
			// Initialize items.
				items.forEach(function(p) {
	
					var i = p.firstElementChild;
	
					// Set parent to placeholder.
						p.style.backgroundImage = 'url(' + i.src + ')';
						p.style.backgroundSize = '100% 100%';
						p.style.backgroundPosition = 'top left';
						p.style.backgroundRepeat = 'no-repeat';
	
					// Hide image.
						i.style.opacity = 0;
						i.style.transition = 'opacity 0.375s ease-in-out';
	
					// Load event.
						i.addEventListener('load', loadHandler);
	
					// Add to scroll events.
						scrollEvents.add({
							element: i,
							enter: enterHandler,
							offset: 250
						});
	
				});
	
		})();

})();