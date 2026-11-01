<section id="publications" class="block">
<h2>Publications</h2>

<div class="pub-filters" role="toolbar" aria-label="Filter publications">
  <button class="chip is-active" data-filter="all">All</button>
  <button class="chip" data-filter="sense">👀 Sense</button>
  <button class="chip" data-filter="adapt">🧠 Adapt</button>
  <button class="chip" data-filter="act">🤖 Act</button>
</div>

<div class="publications">
<ol class="bibliography">

{% for link in site.data.publications.main %}
<li class="pub-card" id="pub-{{ link.key }}" data-themes="{{ link.themes | join: ' ' }}">
  <div class="pub-media">
    {% if link.image %}
    <img src="{{ link.image }}" class="teaser" alt="{{ link.key }} teaser" loading="lazy" decoding="async">
    {% endif %}
    {% if link.conference_short %}
    <abbr class="badge">{{ link.conference_short }}</abbr>
    {% else %}
    <abbr class="badge badge-soft">{{ link.conference }}</abbr>
    {% endif %}
  </div>
  <div class="pub-body">
    {% if link.tagline %}
    <div class="tagline-row"><span class="pub-tagline">🔎 {{ link.tagline }}</span></div>
    {% endif %}
    <div class="title"><a href="{{ link.pdf }}" target="_blank" rel="noopener">{{ link.title }}</a></div>
    <div class="author">{{ link.authors }}</div>
    <div class="periodical"><em>{{ link.conference }}</em></div>
    <div class="links">
      {% if link.pdf %}
      <a href="{{ link.pdf }}" class="btn" role="button" target="_blank" rel="noopener"><i class="fa-regular fa-file-lines"></i> PDF</a>
      {% endif %}
      {% if link.code %}
      <a href="{{ link.code }}" class="btn" role="button" target="_blank" rel="noopener"><i class="fa-solid fa-code"></i> Code</a>
      {% endif %}
      {% if link.page %}
      <a href="{{ link.page }}" class="btn" role="button" target="_blank" rel="noopener"><i class="fa-solid fa-globe"></i> Project Page</a>
      {% endif %}
      {% if link.bibtex %}
      <a href="{{ link.bibtex }}" class="btn" role="button" target="_blank" rel="noopener"><i class="fa-solid fa-quote-right"></i> BibTex</a>
      {% endif %}
    </div>
    {% if link.notes %}
    <div class="pub-notes">{{ link.notes }}</div>
    {% endif %}
    {% if link.others %}
    <div class="pub-notes">{{ link.others }}</div>
    {% endif %}
  </div>
</li>
{% endfor %}

</ol>
<p class="pub-empty" hidden>No papers in this filter yet — stay tuned! 🧸</p>
</div>
</section>
