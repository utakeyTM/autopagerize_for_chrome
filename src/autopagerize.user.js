// AutoPagerize
// loading next page and inserting into current page.
// http://autopagerize.net/

//
// It doesn't work in Greasemonkey any longer.
//
// this script based on
// GoogleAutoPager(http://la.ma.la/blog/diary_200506231749.htm) and
// estseek autopager(http://la.ma.la/blog/diary_200601100209.htm).
// thanks to ma.la.
//
// Released under the GPL license
// http://www.gnu.org/copyleft/gpl.html
//

(function() {

var DEBUG = false
var BASE_REMAIN_HEIGHT = 400
var MIN_REQUEST_INTERVAL = 2000
var FORCE_TARGET_WINDOW = true // FIXME config
var SITEINFO_IMPORT_URLS = [
    'http://wedata.net/databases/AutoPagerize/items.json',
]
var SITEINFO = [
    /* sample
    {
        url:          'http://(.*).google.+/(search).+',
        nextLink:     'id("navbar")//td[last()]/a',
        pageElement:  '//div[@id="res"]/div',
        exampleUrl:   'http://www.google.com/search?q=nsIObserver',
    },
    */
    /* template
    {
        url:          '',
        nextLink:     '',
        pageElement:  '',
        exampleUrl:   '',
    },
    */
]
var MICROFORMAT = {
    url:          '.*',
    nextLink:     '//a[@rel="next"] | //link[@rel="next"]',
    insertBefore: '//*[contains(@class, "autopagerize_insert_before")]',
    pageElement:  '//*[contains(@class, "autopagerize_page_element")]',
}

function AutoPager(info) {
    this.pageNum = 1
    this.info = info
    this.state = settings.disable ? 'disable' : 'enable'
    var self = this
    var url = this.getNextURL(info.nextLink, document, location.href)

    if (!url) {
        debug("getNextURL returns null.", info.nextLink)
        return
    }
    if (info.insertBefore) {
        this.insertPoint = getFirstElementByXPath(info.insertBefore)
    }

    if (!this.insertPoint) {
        var lastPageElement = getElementsByXPath(info.pageElement).pop()
        if (lastPageElement) {
            this.insertPoint = lastPageElement.nextSibling ||
                lastPageElement.parentNode.appendChild(document.createTextNode(' '))
        }
    }

    if (!this.insertPoint) {
        debug("insertPoint not found.", lastPageElement, info.pageElement)
        return
    }

    this.requestURL = url
    this.loadedURLs = {}
    this.loadedURLs[location.href] = true
    var toggle = function() { self.stateToggle() }
    this.toggle = toggle
    this.scroll= function() { self.onScroll() }
    window.addEventListener("scroll", this.scroll, false)

    this.initMessageBar()
    extension.addListener('toggleRequest', function(res) {
        if (ap) {
            ap.toggle()
        }
    })
    extension.postMessage('launched', {url: location.href })

    var scrollHeight = getScrollHeight()
    var bottom = getElementPosition(this.insertPoint).top ||
        this.getPageElementsBottom() ||
        (Math.round(scrollHeight * 0.8))
    this.remainHeight = scrollHeight - bottom + BASE_REMAIN_HEIGHT
    this.reqTime = new Date()
    this.onScroll()

    var that = this
    document.addEventListener('AutoPagerizeToggleRequest', function() {
        that.toggle()
    }, false)
    document.addEventListener('AutoPagerizeUpdateSettingsRequest', function() {
        extension.postMessage('settings', {}, function(res) {
            settings = res
        })
    }, false)
}

AutoPager.prototype.getPageElementsBottom = function() {
   try {
        var elems = getElementsByXPath(this.info.pageElement)
        var bs = elems.map(function(i) { return getElementBottom(i) })
        return Math.max.apply(Math, bs)
    }
    catch(e) {}
}

AutoPager.prototype.initMessageBar = function() {
    var frame = document.createElement('iframe')
    frame.id = 'autopagerize_message_bar'
    frame.style.display = 'none'
    frame.style.position = 'fixed'
    frame.style.bottom = '0px'
    frame.style.left = '0px'
    frame.style.height = '25px'
    frame.style.border = '0px'
    frame.style.opacity = '0.8'
    frame.style.zIndex = '1000'
    frame.width = '100%'
    frame.scrolling = 'no'
    this.messageFrame = frame
    var u = settings['extension_path'] ?
        settings['extension_path'] + 'loading.html' :
        'http://autopagerize.net/files/loading.html'
    this.messageFrame.src = u
    document.body.appendChild(frame)
}

AutoPager.prototype.onScroll = function() {
    var scrollHeight = Math.max(document.documentElement.scrollHeight,
                                document.body.scrollHeight)
    var remain = scrollHeight - window.innerHeight - window.scrollY
    if (this.state == 'enable' && remain < this.remainHeight) {
          this.request()
    }
}

AutoPager.prototype.stateToggle = function() {
    if (this.state == 'enable') {
        this.disable()
    }
    else {
        this.enable()
    }
}

AutoPager.prototype.enable = function() {
    this.state = 'enable'
}

AutoPager.prototype.disable = function() {
    this.state = 'disable'
}

AutoPager.prototype.request = function() {
    if (!this.requestURL || this.lastRequestURL == this.requestURL) {
        return
    }
    var self = this
    var now = new Date()
    if (this.reqTime && now - this.reqTime < MIN_REQUEST_INTERVAL) {
        setTimeout(function() { self.onScroll() }, MIN_REQUEST_INTERVAL)
        return
    }
    else {
        this.reqTime = now
    }

    this.lastRequestURL = this.requestURL
    this.showLoading(true)
    if (Extension.isFirefox()) {
        extension.postMessage('get', { url:  this.requestURL, fromURL: location.href, charset: document.characterSet }, function(res) {
            if (res.responseText && res.finalURL) {
                self.load(createHTMLDocumentByString(res.responseText), res.finalURL)
            }
            else {
                self.error()
            }
        })
    }
    else {
        loadWithIframe(this.requestURL, function(doc, url) {
            self.load(doc, url)
        }, function(err) {
            self.error()
        })
    }
}

AutoPager.prototype.showLoading = function(sw) {
    if (sw) {
        if (this.messageFrame && settings['display_message_bar']) {
            this.messageFrame.style.display = 'block'
        }
    }
    else {
        if (this.messageFrame) {
            this.messageFrame.style.display = 'none'
        }
    }
}

AutoPager.prototype.load = function(htmlDoc, url) {
    if (url && !isSameDomain(url)) {
        this.error()
        return
    }

    AutoPager.documentFilters.forEach(function(i) {
        i(htmlDoc, this.requestURL, this.info)
    }, this)
    try {
        var page = getElementsByXPath(this.info.pageElement, htmlDoc)
        var url = this.getNextURL(this.info.nextLink, htmlDoc, this.requestURL)
    }
    catch(e){
        this.error()
        return
    }

    if (!page || page.length < 1 ) {
        debug('pageElement not found.' , this.info.pageElement)
        this.terminate()
        return
    }

    if (this.loadedURLs[this.requestURL]) {
        debug('page is already loaded.', this.requestURL, this.info.nextLink)
        this.terminate()
        return
    }

    this.loadedURLs[this.requestURL] = true
    page = this.addPage(htmlDoc, page)
    AutoPager.filters.forEach(function(i) {
        i(page)
    })
    this.requestURL = url
    this.showLoading(false)
    this.onScroll()
    if (!url) {
        debug('nextLink not found.', this.info.nextLink, htmlDoc)
        this.terminate()
    }
    var ev = document.createEvent('Event')
    ev.initEvent('GM_AutoPagerizeNextPageLoaded', true, false)
    document.dispatchEvent(ev)
}

AutoPager.prototype.addPage = function(htmlDoc, page) {
    var HTML_NS  = 'http://www.w3.org/1999/xhtml'
    var hr = document.createElementNS(HTML_NS, 'hr')
    var p  = document.createElementNS(HTML_NS, 'p')
    hr.setAttribute('class', 'autopagerize_page_separator')
    p.setAttribute('class', 'autopagerize_page_info')
    var self = this

    if (getRoot(this.insertPoint) != document) {
        var lastPageElement = getElementsByXPath(this.info.pageElement).pop()
        if (lastPageElement) {
            this.insertPoint = lastPageElement.nextSibling ||
                lastPageElement.parentNode.appendChild(document.createTextNode(' '))
        }
    }

    if (page[0] && page[0].tagName == 'TR') {
        var insertParent = this.insertPoint.parentNode
        var colNodes = getElementsByXPath('child::tr[1]/child::*[self::td or self::th]', insertParent)

        var colums = 0
        for (var i = 0, l = colNodes.length; i < l; i++) {
            var col = colNodes[i].getAttribute('colspan')
            colums += parseInt(col, 10) || 1
        }
        var td = document.createElement('td')
        // td.appendChild(hr)
        td.appendChild(p)
        var tr = document.createElement('tr')
        td.setAttribute('colspan', colums)
        tr.appendChild(td)
        insertParent.insertBefore(tr, this.insertPoint)
    }
    else {
        this.insertPoint.parentNode.insertBefore(hr, this.insertPoint)
        this.insertPoint.parentNode.insertBefore(p, this.insertPoint)
    }

    p.innerHTML = 'page: <a class="autopagerize_link" href="' +
        this.requestURL.replace(/&/g, '&amp;') + '">' + (++this.pageNum) + '</a>'
    return page.map(function(i) {
        var pe = document.importNode(i, true)
        self.insertPoint.parentNode.insertBefore(pe, self.insertPoint)
        var ev = document.createEvent('MutationEvent')
        ev.initMutationEvent('AutoPagerize_DOMNodeInserted', true, false,
                             self.insertPoint.parentNode, null,
                             self.requestURL, null, null)
        pe.dispatchEvent(ev)
        return pe
    })
}

AutoPager.prototype.getNextURL = function(xpath, doc, url) {
    var nextLink = getFirstElementByXPath(xpath, doc)
    if (nextLink) {
        var nextValue = nextLink.getAttribute('href') ||
            nextLink.getAttribute('action') || nextLink.value
        if (nextValue.match(/^http(s)?:/)) {
            return nextValue
        }
        else {
            var base = getFirstElementByXPath('//base[@href]', doc)
            return resolvePath(nextValue, (base ? base.href : url))
        }
    }
}

AutoPager.prototype.terminate = function() {
    window.removeEventListener('scroll', this.scroll, false)
    var self = this
    setTimeout(function() {
        if (self.icon) {
            self.icon.parentNode.removeChild(self.icon)
        }
        if (self.messageFrame) {
            var mf = self.messageFrame
            mf.parentNode.removeChild(mf)
        }
    }, 1500)
}

AutoPager.prototype.error = function() {
    window.removeEventListener('scroll', this.scroll, false)
    if (this.messageFrame) {
        var mf = this.messageFrame
        var u = settings['extension_path'] ?
            settings['extension_path'] + 'error.html' :
            'http://autopagerize.net/files/error.html'
        mf.src = u
        mf.style.display = 'block'
        setTimeout(function() {
            if (mf) {
                mf.parentNode.removeChild(mf)
            }
        }, 3000)
    }
}

AutoPager.documentFilters = []
AutoPager.filters = []

AutoPager.launchAutoPager = function(list) {
    if (list.length == 0) {
        return
    }
    for (var i = 0; i < list.length; i++) {
        try {
            if (ap) {
                return
            }
            else if (!location.href.match(list[i].url)) {
            }
            else if (!getFirstElementByXPath(list[i].nextLink)) {
                // FIXME microformats case detection.
                // limiting greater than 12 to filter microformats like SITEINFOs.
                if (list[i].url.length > 12 ) {
                    debug("nextLink not found.", list[i].nextLink)
                }
            }
            else if (!getFirstElementByXPath(list[i].pageElement)) {
                if (list[i].url.length > 12 ) {
                    debug("pageElement not found.", list[i].pageElement)
                }
            }
            else {
                ap = new AutoPager(list[i])
                return
            }
        }
        catch(e) {
            continue
        }
    }
}

if (window != window.parent) {
    return
}

var linkFilter = function(doc, url) {
    var base = getFirstElementByXPath('//base[@href]', doc)
    var baseUrl = base ? base.href : url
    var isSameBase = isSameBaseUrl(location.href, baseUrl)
    if (!FORCE_TARGET_WINDOW && isSameBase) {
        return
    }

    var anchors = getElementsByXPath('descendant-or-self::a[@href]', doc)
    anchors.forEach(function(i) {
        var attrHref = i.getAttribute('href')
        if (FORCE_TARGET_WINDOW && !attrHref.match(/^#|^javascript:/) &&
            i.className.indexOf('autopagerize_link') < 0) {
            i.target = '_blank'
        }
        if (!isSameBase && !attrHref.match(/^#|^\w+:/)) {
            i.href = resolvePath(i.getAttribute('href'), baseUrl)
        }
    })

    if (!isSameBase) {
        var images = getElementsByXPath('descendant-or-self::img[@src]', doc)
        images.forEach(function(i) {
            i.src = resolvePath(i.getAttribute('src'), baseUrl)
        })
    }
}
AutoPager.documentFilters.push(linkFilter)

if (Extension.isFirefox()) {
    fixResolvePath()
}

if (typeof(window.AutoPagerize) == 'undefined') {
    window.AutoPagerize = {}
    window.AutoPagerize.addFilter = function(f) {
        AutoPager.filters.push(f)
    }
    window.AutoPagerize.addDocumentFilter = function(f) {
        AutoPager.documentFilters.push(f)
    }
    window.AutoPagerize.launchAutoPager = AutoPager.launchAutoPager
    var ev = document.createEvent('Event')
    ev.initEvent('GM_AutoPagerizeLoaded', true, false)
    document.dispatchEvent(ev)
}

var settings = {}
var ap = null
var extension = new Extension()
extension.postMessage('settings', {}, function(res) {
    settings = res
    extension.postMessage('siteinfo', { url: location.href }, function(res) {
        if (!settings['exclude_patterns'] || !isExclude(settings['exclude_patterns'])) {
            AutoPager.launchAutoPager(SITEINFO)
            AutoPager.launchAutoPager(res)
            AutoPager.launchAutoPager([MICROFORMAT])
        }
    })
})
extension.addListener('updateSettings', function(res) {
    settings = res
})

// new google search sucks!
if (location.href.match('^http://[^.]+\.google\.(?:[^.]{2,3}\.)?[^./]{2,3}/.*(&fp=)')) {
    var to = location.href.replace(/&fp=.*/, '')
    // console.log([location.href, to])
    location.href = to
}


// utility functions.
function getElementsByXPath(xpath, node) {
    var nodesSnapshot = getXPathResult(xpath, node,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE || 7)
    var data = []
    for (var i = 0; i < nodesSnapshot.snapshotLength; i++) {
        data.push(nodesSnapshot.snapshotItem(i))
    }
    return data
}

function getFirstElementByXPath(xpath, node) {
    var result = getXPathResult(xpath, node,
        XPathResult.FIRST_ORDERED_NODE_TYPE || 9)
    return result.singleNodeValue
}

function getXPathResult(xpath, node, resultType) {
    var node = node || document
    var doc = node.ownerDocument || node
    var resolver = doc.createNSResolver(node.documentElement || node)
    // Use |node.lookupNamespaceURI('')| for Opera 9.5
    var defaultNS = node.lookupNamespaceURI(null)

    if (defaultNS) {
        const defaultPrefix = '__default__'
        xpath = addDefaultPrefix(xpath, defaultPrefix)
        var defaultResolver = resolver
        resolver = function (prefix) {
            return (prefix == defaultPrefix)
                ? defaultNS : defaultResolver.lookupNamespaceURI(prefix)
        }
    }
    return doc.evaluate(xpath, node, resolver, resultType, null)
}

function addDefaultPrefix(xpath, prefix) {
    const tokenPattern = /([A-Za-z_\u00c0-\ufffd][\w\-.\u00b7-\ufffd]*|\*)\s*(::?|\()?|(".*?"|'.*?'|\d+(?:\.\d*)?|\.(?:\.|\d+)?|[\)\]])|(\/\/?|!=|[<>]=?|[\(\[|,=+-])|([@$])/g
    const TERM = 1, OPERATOR = 2, MODIFIER = 3
    var tokenType = OPERATOR
    prefix += ':'
    function replacer(token, identifier, suffix, term, operator, modifier) {
        if (suffix) {
            tokenType =
                (suffix == ':' || (suffix == '::' &&
                 (identifier == 'attribute' || identifier == 'namespace')))
                ? MODIFIER : OPERATOR
        }
        else if (identifier) {
            if (tokenType == OPERATOR && identifier != '*') {
                token = prefix + token
            }
            tokenType = (tokenType == TERM) ? OPERATOR : TERM
        }
        else {
            tokenType = term ? TERM : operator ? OPERATOR : MODIFIER
        }
        return token
    }
    return xpath.replace(tokenPattern, replacer)
}

function debug() {
    if ( typeof DEBUG != 'undefined' && DEBUG ) {
        console.log.apply(console, arguments)
    }
}

function getElementPosition(elem) {
    var offsetTrail = elem
    var offsetLeft  = 0
    var offsetTop   = 0
    while (offsetTrail) {
        offsetLeft += offsetTrail.offsetLeft
        offsetTop  += offsetTrail.offsetTop
        offsetTrail = offsetTrail.offsetParent
    }
    offsetTop = offsetTop || null
    offsetLeft = offsetLeft || null
    return {left: offsetLeft, top: offsetTop}
}

function getElementBottom(elem) {
    var c_style = document.defaultView.getComputedStyle(elem, '')
    var height  = 0
    var prop    = ['height', 'borderTopWidth', 'borderBottomWidth',
                   'paddingTop', 'paddingBottom',
                   'marginTop', 'marginBottom']
    prop.forEach(function(i) {
        var h = parseInt(c_style[i])
        if (typeof h == 'number') {
            height += h
        }
    })
    var top = getElementPosition(elem).top
    return top ? (top + height) : null
}

function getScrollHeight() {
    return Math.max(document.documentElement.scrollHeight,
                                document.body.scrollHeight)
}

function isSameDomain(url) {
    if (url.match(/^\w+:/)) {
        return location.host == url.split('/')[2]
    }
    else {
        return true
    }
}

function isSameBaseUrl(urlA, urlB) {
    return (urlA.replace(/[^/]+$/, '') == urlB.replace(/[^/]+$/, ''))
}

function resolvePath(path, base) {
    if (path.match(/^https?:\/\//)) {
        return path
    }
    else if (path.match(/^\?/)) {
        return base + path
    }
    else if (path.match(/^[^\/]/)) {
        return base.replace(/[^/]+$/, '') + path
    }
    else {
        return base.replace(/([^/]+:\/\/[^/]+)\/.*/, '\$1') + path
    }
}

function fixResolvePath() {
    if (resolvePath('', 'http://resolve.test/') == 'http://resolve.test/') {
        return
    }
    // A workaround for WebKit and Mozilla 1.9.2a1pre,
    // which don't support XML Base in HTML.
    // https://bugs.webkit.org/show_bug.cgi?id=17423
    // https://bugzilla.mozilla.org/show_bug.cgi?id=505783
    var XML_NS = 'http://www.w3.org/XML/1998/namespace'
    var baseElement = document.createElementNS(null, 'base')
    var pathElement = document.createElementNS(null, 'path')
    baseElement.appendChild(pathElement)
    resolvePath = function resolvePath_workaround(path, base) {
        baseElement.setAttributeNS(XML_NS, 'xml:base', base)
        pathElement.setAttributeNS(XML_NS, 'xml:base', path)
        return pathElement.baseURI
    }
}

function strip_html_tag(str) {
    var chunks = str.split(/(<html(?:[ \t\r\n][^>]*)?>)/)
    if (chunks.length >= 3) {
        chunks.splice(0, 2)
    }
    str = chunks.join('')
    chunks = str.split(/(<\/html[ \t\r\n]*>)/)
    if (chunks.length >= 3) {
        chunks.splice(chunks.length - 2)
    }
    return chunks.join('')
}

function wildcard2regep(str) {
    return '^' + str.replace(/([-()\[\]{}+?.$\^|,:#<!\\])/g, '\\$1').replace(/\x08/g, '\\x08').replace(/\*/g, '.*')
}

function isExclude(patterns) {
    var rr = /^\/(.+)\/$/
    var eps = (patterns || '').split(/[\r\n ]+/)
    for (var i = 0; i < eps.length; i++) {
        var reg = null
        if (rr.test(eps[i])) {
            reg = eps[i].match(rr)[1]
        }
        else {
            reg = wildcard2regep(eps[i])
        }
        if (eps[i].match(/[^\s+]/) && location.href.match(reg)) {
            return true
        }
    }
    return false
}

function loadWithIframe(url, callback, errback) {
    var iframe = document.createElement('iframe')
    iframe.sandbox = 'allow-same-origin'
    iframe.style.display = 'none'
    iframe.src = url
    document.body.appendChild(iframe)
    var contentload = function() {
        try {
            if (!iframe.contentDocument) {
                errback()
            }
            else {
                var loadedURL = iframe.contentWindow ? iframe.contentWindow.location.href : null
                var doc = iframe.contentDocument
                var ss =  doc.querySelectorAll('script')
                for (var i = 0; i < ss.length; i++) {
                    ss[i].parentNode.removeChild(ss[i])
                }
                callback(iframe.contentDocument, loadedURL)
            }
            iframe.parentNode.removeChild(iframe)
        }
        catch(e) {
            errback()
        }
    }
    iframe.onload = contentload
    iframe.onerror = errback
}

function createHTMLDocumentByString(str) {
    if (document.documentElement.nodeName != 'HTML') {
        return new DOMParser().parseFromString(str, 'application/xhtml+xml')
    }
    var html = strip_html_tag(str)
    var htmlDoc
    try {
        // We have to handle exceptions since Opera 9.6 throws
        // a NOT_SUPPORTED_ERR exception for |document.cloneNode(false)|
        // against the DOM 3 Core spec.
        htmlDoc = document.cloneNode(false)
        htmlDoc.appendChild(htmlDoc.importNode(document.documentElement, false))
    }
    catch(e) {
        htmlDoc = document.implementation.createDocument(null, 'html', null)
    }
    var fragment = createDocumentFragmentByString(html)
    try {
        fragment = htmlDoc.adoptNode(fragment)
    }
    catch(e) {
        fragment = htmlDoc.importNode(fragment, true)
    }
    htmlDoc.documentElement.appendChild(fragment)
    return htmlDoc
}

function createDocumentFragmentByString(str) {
    var range = document.createRange()
    range.setStartAfter(document.body)
    return range.createContextualFragment(str)
}

function getRoot(element) {
    var limit = 1000
    for (var i = 0; i < limit; i++) {
        if (!element.parentNode) {
            return element
        }
        element = element.parentNode
    }
}

})()
