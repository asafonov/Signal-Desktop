/*
 * vim: ts=4:sw=4:expandtab
 */
(function () {
    'use strict';
    // Browser specific functions for Chrom*
    window.extension = window.extension || {};

    const ipc = chrome.ipcRenderer;
    const callbackMap = {};
    const sendMessage = (message, options, callback) => {
      const id = Math.random().toString();
      callbackMap[id] = callback;
      ipc.send(message, id, options);
    };

    const messages = {
      CALLBACK: 'callback',
      CREATE_WINDOW: 'create-window',
      GET_CURRENT_WINDOW: 'get-current-window',
      FOCUS_WINDOW: 'focus-window',
      REMOVE_WINDOW: 'remove-window',
      RESTART: 'restart'
    };

    ipc.on(messages.CALLBACK, (e, id, arg) => {
      if (callbackMap[id]) {
        callbackMap[id](arg);
      }
    });

    window.extension.navigator = (function () {
        var self = {},
            tabs = {};
        tabs.create = function (url) {
            if (chrome.tabs) {
                chrome.tabs.create({url: url});
            } else {
                extension.windows.open({url: url});
            }
        };
        self.tabs = tabs;

        self.setBadgeText = function (text) {
            if (chrome.browserAction && chrome.browserAction.setBadgeText) {
                chrome.browserAction.setBadgeText({text: String(text)});
            }
        };

        return self;
    }());

    extension.windows = {
        open: function(options, callback) {
            sendMessage(messages.CREATE_WINDOW, options, callback);
        },

        focus: function(id, callback) {
            sendMessage(messages.FOCUS_WINDOW, id, callback);
        },

        getCurrent: function(callback) {
            sendMessage(messages.GET_CURRENT_WINDOW, null, callback);
        },

        remove: function(windowId) {
            sendMessage(messages.REMOVE_WINDOW, windowId);
        },

        getBackground: function(callback) {
            var getBackground;
            if (chrome.extension) {
                var bg = chrome.extension.getBackgroundPage();
                bg.storage.onready(function() {
                    callback(bg);
                });
            } else if (chrome.runtime) {
                chrome.runtime.getBackgroundPage(function(bg) {
                    bg.storage.onready(function() {
                        callback(bg);
                    });
                });
            }
        },

        getAll: function() {
            return [];
        },

        getViews: function() {
            if (chrome.extension) {
                return chrome.extension.getViews();
            } else if (chrome.app.window) {
                return chrome.app.window.getAll().map(function(appWindow) {
                    return appWindow.contentWindow;
                });
            }
        },

        onSuspend: function(callback) {
            if (chrome.runtime) {
                chrome.runtime.onSuspend.addListener(callback);
            } else {
                window.addEventListener('beforeunload', callback);
            }
        },
        onClosed: function(callback) {
            // assumes only one front end window
            if (window.chrome && chrome.app && chrome.app.window
              && chrome.app.window.getAll().length) {
                return chrome.app.window.getAll()[0].onClosed.addListener(callback);
            } else {
                window.addEventListener('beforeunload', callback);
            }
        },

        drawAttention: function(window_id) {
            console.log('draw attention');
            if (chrome.app.window) {
                var w = chrome.app.window.get(window_id);
                if (w) {
                    w.clearAttention();
                    w.drawAttention();
                }
            }
        },

        clearAttention: function(window_id) {
            console.log('clear attention');
            if (chrome.app.window) {
                var w = chrome.app.window.get(window_id);
                if (w) {
                    w.clearAttention();
                }
            }
        }

    };

    extension.onLaunched = function(callback) {
      callback()
      /*
        if (chrome.browserAction && chrome.browserAction.onClicked) {
            chrome.browserAction.onClicked.addListener(callback);
        }
        if (chrome.app && chrome.app.runtime) {
            chrome.app.runtime.onLaunched.addListener(callback);
        }
      */
    };

    // Translate
    window.i18n = function(message, substitutions) {
        if (window.chrome && chrome.i18n) {
            return chrome.i18n.getMessage(message, substitutions);
        }
    };
    i18n.getLocale = function() {
        if (window.chrome && chrome.i18n) {
            return chrome.i18n.getUILanguage();
        }
        return 'en';
    };

    extension.install = function(mode) {
        var id = 'installer';
        var url = 'options.html';
        if (mode === 'standalone') {
            id = 'standalone-installer';
            url = 'register.html';
        }
        extension.windows.open({
            id: id,
            url: url,
            bounds: { width: 800, height: 666, },
            minWidth: 800,
            minHeight: 666
        });
    };

    extension.restart = function() {
      sendMessage(messages.RESTART);
    };

    var notification_pending = Promise.resolve();
    extension.notification = {
        init: function() {
            // register some chrome listeners
            if (chrome.notifications) {
                chrome.notifications.onClicked.addListener(function() {
                    extension.notification.clear();
                    Whisper.Notifications.onclick();
                });
                chrome.notifications.onButtonClicked.addListener(function() {
                    extension.notification.clear();
                    Whisper.Notifications.clear();
                    getInboxCollection().each(function(model) {
                        model.markRead();
                    });
                });
                chrome.notifications.onClosed.addListener(function(id, byUser) {
                    if (byUser) {
                        Whisper.Notifications.clear();
                    }
                });
            }
        },
        clear: function() {
            if (!chrome.notifications) {
              return
            }
            notification_pending = notification_pending.then(function() {
                return new Promise(function(resolve) {
                    chrome.notifications.clear('signal',  resolve);
                });
            });
        },
        update: function(options) {
            if (chrome && chrome.notifications) {
                var chromeOpts = {
                    type     : options.type,
                    title    : options.title,
                    message  : options.message || '', // required
                    iconUrl  : options.iconUrl,
                    imageUrl : options.imageUrl,
                    items    : options.items,
                    buttons  : options.buttons
                };
                notification_pending = notification_pending.then(function() {
                    return new Promise(function(resolve) {
                        chrome.notifications.update('signal', chromeOpts, function(wasUpdated) {
                            if (!wasUpdated) {
                                chrome.notifications.create('signal', chromeOpts, resolve);
                            } else {
                                resolve();
                            }
                        });
                    });
                });
            } else {
                var notification = new Notification(options.title, {
                    body : options.message,
                    icon : options.iconUrl,
                    tag  : 'signal'
                });
                notification.onclick = function() {
                    Whisper.Notifications.onclick();
                };
            }
        }
    };

    extension.keepAwake = function() {
        if (chrome && chrome.alarms) {
            chrome.alarms.onAlarm.addListener(function() {
                // nothing to do.
            });
            chrome.alarms.create('awake', {periodInMinutes: 1});
        }
    };

    if (chrome.runtime.onInstalled) {
        chrome.runtime.onInstalled.addListener(function(options) {
            if (options.reason === 'install') {
                console.log('new install');
                extension.install();
            } else if (options.reason === 'update') {
                console.log('new update. previous version:', options.previousVersion);
            } else {
                console.log('onInstalled', options.reason);
            }
        });
    }
}());
