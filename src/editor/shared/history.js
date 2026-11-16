export class History {
  constructor(document, limit = 100) {
    this.present = structuredClone(document);
    this.past = [];
    this.future = [];
    this.limit = limit;
  }

  update(change) {
    const next = structuredClone(this.present);
    change(next);
    return this.commit(next);
  }

  commit(next) {
    if (JSON.stringify(next) === JSON.stringify(this.present)) return false;
    this.past.push(structuredClone(this.present));
    if (this.past.length > this.limit) this.past.shift();
    this.present = structuredClone(next);
    this.future = [];
    return true;
  }

  undo() {
    if (!this.past.length) return false;
    this.future.push(structuredClone(this.present));
    this.present = this.past.pop();
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.past.push(structuredClone(this.present));
    this.present = this.future.pop();
    return true;
  }
}
