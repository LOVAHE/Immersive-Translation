export class BaseTranslator {
  id = 'base';
  label = 'Base Translator';
  constructor(config){ this.config = config || {}; }
  async translate(){ throw new Error('translate() not implemented'); }
}
