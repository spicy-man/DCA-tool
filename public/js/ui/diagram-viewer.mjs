const titles = {
  'monthly_dca_logic.svg': '月跌幅金字塔 · 定投逻辑',
  'fear_dca_logic.svg': '恐慌买入 · 加投逻辑'
};
export function initDiagramViewer() {
  const image = new URLSearchParams(window.location.search).get('image');
  if (Object.hasOwn(titles, image)) {
    const diagram = document.getElementById('diagram');
    document.title = diagram.alt = titles[image];
    diagram.src = './diagrams/' + image;
    diagram.hidden = false;
  }
}
