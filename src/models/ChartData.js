/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-08-14
 * @author Liang <liang@maichong.it>
 */

import alaska from 'alaska';

export default class ChartData extends alaska.Model {

  static label = 'Chart Data';
  static hidden = true;
  static defaultColumns = 'source x y';
  static defaultSort = '-x';

  static fields = {
    source: {
      ref: 'ChartSource',
      index: true,
      required: true
    },
    x: {
      type: Object
    },
    y: {
      type: Number,
      default: 0
    }
  };

  preSave() {
    if (!this.createdAt) {
      this.createdAt = new Date;
    }
  }
}
