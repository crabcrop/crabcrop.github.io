(() => {
  // Real signatures for every state of the hero's URL: HMAC-SHA256, sample secret "demo-secret",
  // over "<operations>/root:photos/print.jpg", lowercase hex. Keyed by the operations.
  const SIGS = {"crop:1200x630:smart":"aa63fb72b60b75e936805e613526ddf61b16bd56a011c8e5ece598712b660f4e","crop:1200x630:smart/filters:format(avif)":"19d54051a18b6309b62726f9d92d8817481153a043a6885bb0bb7e66a2f0436a","crop:1200x630:smart/filters:format(webp)":"9a1d5766093324c8a433a6e864d6f218241be729107f5d3889aee8efd920bc01","crop:1200x630:smart/filters:format(jxl)":"dfe8676b033505dc2b3e4d7ab6461667a246cf0c4ced878829b53397a12f172f","crop:1200x630:smart/filters:sepia":"0b42fb90a4c77b421304919aca125d2def83e3a25e1c751bacc1b22c1ced4d8c","crop:1200x630:smart/filters:sepia:format(avif)":"20f3b8bb2b3e0cbf1821efae537392716baade23b466b6be7473121361a26d6f","crop:1200x630:smart/filters:sepia:format(webp)":"a10cb08e20fa3ede2df4326f65308c6e526c59a44745ebc90bd943cae6219d7a","crop:1200x630:smart/filters:sepia:format(jxl)":"a4a7d6919d5b68d1d777aad14f8daf10ae9b56bbcf358abbd9c62c9285070085","crop:1200x630:smart/filters:grayscale":"8bf5008dd15d324de73f4031ca84ad771f46232f6a22eb092046d09224ca8263","crop:1200x630:smart/filters:grayscale:format(avif)":"15f2f5f1001b980ffbfc1f003eea570999c90984ae58e8e4c341b49121ff4ac8","crop:1200x630:smart/filters:grayscale:format(webp)":"49b281fc181bc9ec6ca686dea5e8c611c0bb840bbd24c3260c4f68670c3291c6","crop:1200x630:smart/filters:grayscale:format(jxl)":"14522b4a13186c8392e99e4dc1c8b7740a5624f6cfe246e75034cb4469588758","crop:1200x630:smart/filters:sharpen(1.2):saturation(1.1)":"3843ad67974400e1c368394dfc3f33326429aabd37c9a15c232662d83a45079a","crop:1200x630:smart/filters:sharpen(1.2):saturation(1.1):format(avif)":"75cf8a42f7f7352590a28f415d1c12ca665b0c2e43990a0f7d3a5c95feccb564","crop:1200x630:smart/filters:sharpen(1.2):saturation(1.1):format(webp)":"e01c8a642e2d972a18fcd3a33f078b9c7a6647385c61b755426b95487b3220d3","crop:1200x630:smart/filters:sharpen(1.2):saturation(1.1):format(jxl)":"a066d900c12d9ec1d235a44bf3f326fbec811ccd2a779f9355f9cd2c3bc87ec4","crop:760x760:smart":"a8eea15ec022f3b74627aa9b1ca80eab6414da72817a13c70b64fb20f7ae73f1","crop:760x760:smart/filters:format(avif)":"c03259f02eb53711e46f992cd028efe243bf074f8743255f2fc1d028c2d8fd10","crop:760x760:smart/filters:format(webp)":"35061a43c75fc18e920a1d6b7e22f3261471e149eb6f7e63c94f8d8ed026a27b","crop:760x760:smart/filters:format(jxl)":"fdff3c9c5964119c20d237a9c971bc2e2f45daa0908a857a5528e3ba1fa1f8cd","crop:760x760:smart/filters:sepia":"554fe713dc905268cbee2c535fa05c50e88c11904f119334fcfeb0e933b960a7","crop:760x760:smart/filters:sepia:format(avif)":"103b4aac9d36109afaa0c8b82bf54532c40926e513d5d9c23d2524df4ec8f891","crop:760x760:smart/filters:sepia:format(webp)":"3100e282c6e95521f48a2bdf98c08f235d0eef47eaee1c2413e70e9daf205c24","crop:760x760:smart/filters:sepia:format(jxl)":"64b02922214358f0039ea1bf7ba83be3b3af415bffe8fa09b677cda3e5848c4b","crop:760x760:smart/filters:grayscale":"c547f6607b2b3f6142f73fbedd887f890f2ae29258404023fce3388a9a0f6ac1","crop:760x760:smart/filters:grayscale:format(avif)":"72d7ed0ae5ca5bb403a1e47aa392492b64e01bb2f988308035edd8100aff6d2f","crop:760x760:smart/filters:grayscale:format(webp)":"9a73fd035da84828bd1bf1736b0838089e63789d1799331ac2aa928167d26ba2","crop:760x760:smart/filters:grayscale:format(jxl)":"65cbc4652d8a668db1bdec62d916c7d05cd5a2cba140649e6008c9914aec8e68","crop:760x760:smart/filters:sharpen(1.2):saturation(1.1)":"06bb78d1b8d64e13ed20f5041704627a6b324d23f09b14c9a3ec06e2b409271e","crop:760x760:smart/filters:sharpen(1.2):saturation(1.1):format(avif)":"0f44c7af39213d74dac6ebea2d478b2d7e05df08521a189e54b559e265685401","crop:760x760:smart/filters:sharpen(1.2):saturation(1.1):format(webp)":"83c0e4c5bfebb123c8db07bcd1352bcbde133f2111e428739a0c6b2eec629630","crop:760x760:smart/filters:sharpen(1.2):saturation(1.1):format(jxl)":"45bdc34c8c493a025ac86c952c71e60756b31b8b43d0a38c1ebafef2821ab8ed","fit-in:1200x630":"05e5d585534701c8f7cf5ee7e20c5a0659c06c29b10c3b0878c4de899f6a5fa9","fit-in:1200x630/filters:format(avif)":"bf5363cd3290c23845ca835bb6212b48354867bc3fbe191badc72a047e770743","fit-in:1200x630/filters:format(webp)":"e46381f6b6c097e072d76dd6a24c06b7356c9e82addcb865206cb5e7636cad8c","fit-in:1200x630/filters:format(jxl)":"33f6cbb1c7a13a7e7467a40e4140dfca37afb199f36e5dd48f0d0b502516f125","fit-in:1200x630/filters:sepia":"d3b8e6338cb2f27eba0290db971ad5e64d42ec4728a2478c48378ef0b824d2b9","fit-in:1200x630/filters:sepia:format(avif)":"28cea84c59ba1af72760c9eb083023b85ff4b2f5e9d4f234d3e2879c84a66bcc","fit-in:1200x630/filters:sepia:format(webp)":"c1d08d001e991a8ca4e689c06bfe6406ebcd79d10174241136abcf654157bf21","fit-in:1200x630/filters:sepia:format(jxl)":"98ea403492b2aab142d23d6b3e33b906541b63afb38428cff6966e60ed5c3412","fit-in:1200x630/filters:grayscale":"0d5de1ac073fb7e29899a7f64ece5c630d946ad2bebd28f9291f95b54a5aa7ff","fit-in:1200x630/filters:grayscale:format(avif)":"5955846e53f51e2e5e379a955419e89390f90497d58d09dc3d5efc726d164a89","fit-in:1200x630/filters:grayscale:format(webp)":"346a5a2c18d342f0cc92eee58221caff1a089ffcdc60768293d3c82eec173e33","fit-in:1200x630/filters:grayscale:format(jxl)":"c911a72047d74064b9195afee149ac0bf33f3c30fbcb196f0d0f8aeee2dbd8b6","fit-in:1200x630/filters:sharpen(1.2):saturation(1.1)":"fe7c55f1cd80b6ae1d2409fa9c1b0360c686f2c356f2622bffb1ac77c24c3cd7","fit-in:1200x630/filters:sharpen(1.2):saturation(1.1):format(avif)":"eb4408be92090952cf3c51e0ead34eabdefe6642790b579fdb93366ad105ba58","fit-in:1200x630/filters:sharpen(1.2):saturation(1.1):format(webp)":"31913bbafd7ce3d04ddb30c4c4da4d6e35143f28422b856718dc2cbdd74ac7dd","fit-in:1200x630/filters:sharpen(1.2):saturation(1.1):format(jxl)":"8921a82fdacb4291c3d173f1fcf2c34fddc82d61c1576b7b2306a290ddc57041"};
  const BASE = 'https://img.example.com/', SRC = 'root:photos/print.jpg';
  const SIZE = {
    'crop:1200x630:smart': { ar: 1200 / 630, pos: '50% 56%', out: '1200 × 630' },
    'crop:760x760:smart': { ar: 1, pos: '23% 50%', out: '760 × 760' },
    'fit-in:1200x630': { ar: 1.5, pos: '50% 50%', out: 'fits inside 1200 × 630, nothing cut' },
  };
  const LOOK = { '': 'none', 'sepia': 'sepia(.85) saturate(1.05)', 'grayscale': 'grayscale(1)', 'sharpen(1.2):saturation(1.1)': 'contrast(1.06) saturate(1.14)' };
  const FMT = { '': 'No format named: the Accept header decides', 'format(avif)': 'Format AVIF', 'format(webp)': 'Format WebP', 'format(jxl)': 'Format JPEG XL' };

  const $ = (id) => document.getElementById(id);
  const form = $('controls'), urlEl = $('url'), frame = $('frame'), shot = $('shot');
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // code breaks only between its parts: after a slash, a colon or a comma
  const soft = (t) => esc(t).replace(/([/:,])(?=[^/\s])/g, '$1<wbr>');
  const val = (name) => form.elements[name].value;
  let full = '';

  function render() {
    const size = val('size'), look = val('look'), fmt = val('fmt');
    const filters = [look, fmt].filter(Boolean).join(':');
    const ops = [size].concat(filters ? ['filters:' + filters] : []);
    const sig = SIGS[ops.join('/')] || '';
    full = BASE + sig + '/' + ops.join('/') + '/' + SRC;
    urlEl.innerHTML = 'https://<wbr>img.example.com/<wbr>'
      + '<span class="seg sig" title="The signature, shortened here">' + sig.slice(0, 8) + '…</span>/<wbr>'
      + ops.map((o) => '<span class="seg op">' + soft(o) + '</span>/<wbr>').join('')
      + '<span class="seg src">' + soft(SRC) + '</span>';
    const s = SIZE[size];
    frame.style.setProperty('--ar', String(s.ar));
    frame.style.setProperty('--pos', s.pos);
    shot.style.filter = LOOK[look];
    $('out-size').textContent = s.out;
    $('out-fmt').textContent = FMT[fmt];
    for (const input of form.querySelectorAll('input')) input.closest('.opt').classList.toggle('on', input.checked);
  }
  form.addEventListener('change', render);
  form.addEventListener('submit', (e) => e.preventDefault());
  render();

  // Copy: the clipboard where it is allowed, else the text is selected for the viewer to copy.
  async function copy(btn, text, from) {
    const label = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch (err) {
      if (from) { const r = document.createRange(); r.selectNodeContents(from); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      btn.textContent = from ? 'Selected' : 'Not copied';
    }
    setTimeout(() => { btn.textContent = label; }, 1600);
  }
  $('copy-url').addEventListener('click', (e) => copy(e.currentTarget, full, urlEl));
  for (const btn of document.querySelectorAll('.copy[data-select]')) {
    btn.addEventListener('click', () => { const from = $(btn.dataset.select); copy(btn, from.textContent, from); });
  }

  // Snap moves when there is a reason to. Each film ends on the frame it began with, so it plays once and he is
  // at rest again: in the hero now and then, whenever the URL changes, and as a pointer comes to him (there he is
  // the link down to his world, so a tap takes the visitor there); on the install command just below it when he
  // comes into view, when the command is copied, and on a tap. With reduced motion he stays still.
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const point = $('snap-point'), cheer = $('snap-cheer');
  function act(film) {
    if (calm.matches || !(film.paused || film.ended)) return;
    const p = film.play();
    if (p) p.catch(() => {});
  }
  cheer.parentNode.addEventListener('click', () => act(cheer));
  point.parentNode.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') act(point); });
  point.parentNode.addEventListener('focus', () => act(point));

  let inView = true, rest = 0;
  const later = () => { clearTimeout(rest); rest = setTimeout(() => { if (inView && !document.hidden) act(point); else later(); }, 5200); };
  point.addEventListener('ended', later);
  form.addEventListener('change', () => act(point));
  $('install-cmd').nextElementSibling.addEventListener('click', () => act(cheer));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => { inView = e.isIntersecting; }, { threshold: .4 }).observe(point);
    // (his film is fetched as he nears the screen, and played the first time most of him is in view)
    const near = new IntersectionObserver(([e]) => { if (e.isIntersecting) { cheer.preload = 'auto'; near.disconnect(); } }, { rootMargin: '900px 0px' });
    near.observe(cheer);
    const arrive = new IntersectionObserver(([e]) => { if (e.isIntersecting) { act(cheer); arrive.disconnect(); } }, { threshold: .7 });
    arrive.observe(cheer);
  }
  setTimeout(() => act(point), 900);

  // The signing tabs
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const pane = (t) => $(t.getAttribute('aria-controls'));
  function pick(t, focus) {
    for (const x of tabs) { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; pane(x).hidden = !on; }
    if (focus) t.focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => pick(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); pick(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  $('copy-snippet').addEventListener('click', (e) => { const p = pane(tabs.find((t) => t.getAttribute('aria-selected') === 'true')); copy(e.currentTarget, p.textContent, p); });
})();
