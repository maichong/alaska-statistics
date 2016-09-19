/**
 * @copyright Maichong Software Ltd. 2016 http://maichong.it
 * @date 2016-09-12
 * @author Liang <liang@maichong.it>
 */

import _ from 'lodash';
import moment from 'moment';
import alaska from 'alaska';
import service from '../';
import ChartSource from '../models/ChartSource';
import ChartData from '../models/ChartData';

function getFirstDate(date, unit) {
  return moment(date).startOf(unit);
}

function getLastDate(date, unit) {
  return moment(date).endOf(unit);
}

function getCycleX(date, unit) {
  date = moment(date);
  if (!date.isValid()) return '';
  switch (unit) {
    case 'quarter':
      //季度循环 1~4
      return date.quarter();
    case 'month':
      //月份循环 1~12
      return date.month() + 1;
    case 'week':
      //每周天数 0~6
      return date.day();
    case 'day':
      //每月天数 1~31
      return date.date();
    case 'hour':
      //每小时 0~23
      return date.hour();
  }
  return '';
}

function getTimeX(date, unit) {
  date = moment(date);
  switch (unit) {
    case 'year':
    case 'quarter':
    case 'month':
      date.date(1);
    case 'week':
    case 'day':
      date.hour(0);
    case 'hour':
      date.minute(0);
    case 'minute':
      date.second(0);
  }
  date.millisecond(0);
  if (unit == 'year') {
    date.month(1);
  } else if (unit == 'quarter') {
    date.month(date.quarter() * 4 - 3);
  }
  return date.valueOf().toString();
}

async function buildTimeData(source, Model, filters) {
  const { x, y, reducer, unit } = source;
  let first = Model.findOne(filters);
  if (!filters || !filters[x]) {
    first.where(x).gt(new Date(0));
  }
  first = await first.sort(x);
  let lastRecord = await Model.findOne(filters).sort('-' + x);
  let firstDate = getFirstDate(first[x], unit);
  let lastDate = getLastDate(lastRecord[x], unit);

  let from = firstDate;
  let to = moment(from).add(1, unit + 's');

  let size = (lastDate.valueOf() - firstDate.valueOf()) / moment.duration(1, unit + 's').as('milliseconds');

  if (size > 1000) {
    //查询次数优化
    let result = {};
    let count = {};
    let last = null;

    let select = x;
    if (reducer !== 'count') {
      select += ' ' + y;
    }
    while (true) {
      let list = Model.find(filters).sort('_id').limit(1000).select(select);
      if (last) {
        list.where('_id').gt(last);
      }
      list = await list;
      if (!list.length) break;
      for (let record of list) {
        last = record._id;
        let key = getTimeX(record.get(x), unit);
        if (!result[key]) {
          result[key] = 0;
          count[key] = 0;
        }
        switch (reducer) {
          case 'count':
            result[key]++;
            break;
          case 'max':
            result[key] = Math.max(result[key], record.get(y));
            break;
          case 'min':
            result[key] = Math.min(result[key], record.get(y));
            break;
          case 'sum':
          case 'average':
            count[key]++;
            result[key] += record.get(y) || 0;
            break;
        }
      }
    }

    let precision = source.precision || 0;
    _.forEach(result, (y, x) => {
      if (reducer === 'average') {
        y /= count[x];
      }
      y = _.round(y, precision);
      (new ChartData({ source, x: new Date(x * 1), y })).save();
    });
    return;
  }

  if (reducer === 'count') {
    while (true) {
      if (from.isAfter(lastDate)) {
        break;
      }
      if (!filters) {
        filters = {};
      }
      if (!filters[x]) {
        filters[x] = {};
      }
      filters[x].$gte = from;
      filters[x].$lt = to;
      let count = await Model.count(filters);
      if (count) {
        await (new ChartData({
          source,
          x: from.toDate(),
          y: count
        })).save();
      }
      from = moment(to);
      to = moment(from).add(1, unit + 's');
    }
  } else {
    //sum avg min max
    while (true) {
      if (from.isAfter(lastDate)) {
        break;
      }
      let list = await Model.find(filters).where({
        [x]: {
          $gte: from,
          $lt: to
        }
      }).select(y);
      if (list.length) {
        let value = 0;
        for (let item of list) {
          let v = item.get(y) || 0;
          switch (reducer) {
            case 'sum':
            case 'average':
              value += v;
              break;
            case 'min':
              value = Math.min(value, v);
              break;
            case 'max':
              value = Math.max(value, v);
              break;
          }
        }
        if (reducer === 'average') {
          value = value / list.length;
        }
        value = _.round(value, source.precision || 0);
        await (new ChartData({
          source,
          x: from.toDate(),
          y: value
        })).save();
      }
      from = moment(to);
      to = moment(from).add(1, unit + 's');
    }
  }
}

async function buildCycleData(source, Model, filters) {
  const { x, y, reducer, unit } = source;
  let last;
  let result = {};
  let count = {};
  let select = x;
  if (reducer !== 'count') {
    select += ' ' + y;
  }

  while (true) {
    let list = Model.find(filters).sort('_id').limit(1000).select(select);
    if (last) {
      list.where('_id').gt(last);
    }
    list = await list;
    if (!list.length) break;
    for (let record of list) {
      last = record._id;
      let key = getCycleX(record.get(x), unit);
      if (!result[key]) {
        result[key] = 0;
        count[key] = 0;
      }
      switch (reducer) {
        case 'count':
          result[key]++;
          break;
        case 'max':
          result[key] = Math.max(result[key], record.get(y));
          break;
        case 'min':
          result[key] = Math.min(result[key], record.get(y));
          break;
        case 'sum':
        case 'average':
          count[key]++;
          result[key] += record.get(y) || 0;
          break;
      }
    }
  }

  let precision = source.precision || 0;
  result = _.map(result, (y, x) => {
    if (reducer === 'average') {
      y /= count[x];
    }
    y = _.round(y, precision);
    return { x, y };
  });

  result = _.sortBy(result, 'x');

  for (let data of result) {
    await (new ChartData({ source, x: data.x, y: data.y })).save();
  }
}

async function buildEnumData(source, Model, filters) {
  const { x, y, reducer } = source;
  let last;
  let result = {};
  let count = {};
  let select = x;
  if (reducer !== 'count') {
    select += ' ' + y;
  }

  while (true) {
    let list = Model.find(filters).sort('_id').limit(1000).select(select);
    if (last) {
      list.where('_id').gt(last);
    }
    list = await list;
    if (!list.length) break;
    for (let record of list) {
      last = record._id;
      let key = record.get(x);
      if (!result[key]) {
        result[key] = 0;
        count[key] = 0;
      }
      switch (reducer) {
        case 'count':
          result[key]++;
          break;
        case 'max':
          result[key] = Math.max(result[key], record.get(y));
          break;
        case 'min':
          result[key] = Math.min(result[key], record.get(y));
          break;
        case 'sum':
        case 'average':
          count[key]++;
          result[key] += record.get(y) || 0;
          break;
      }
    }
  }

  let precision = source.precision || 0;
  _.forEach(result, (y, x) => {
    if (reducer === 'average') {
      y /= count[x];
    }
    y = _.round(y, precision);
    (new ChartData({ source, x, y })).save();
  });
}

async function buildCustomData(source, Model, filters, custom) {
  let last;
  let result = {};
  while (true) {
    let list = Model.find(filters).sort('_id').limit(1000);
    if (last) {
      list.where('_id').gt(last);
    }
    if (custom.select) {
      list.select(custom.select);
    }
    list = await list;
    if (!list.length) break;
    for (let record of list) {
      result = custom.fn(result, record);
      last = record._id;
    }
  }
  if (custom.final) {
    result = custom.final(result);
  } else {
    result = _.map(result, (y, x) => ({ x, y }));
  }
  result.forEach(({ x, y }) => (new ChartData({ source, x, y })).save());
}

async function buildChartSource(chartSource, startDate) {
  const { model, type, reducer, x } = chartSource;
  let filters = chartSource._.filters.filter();

  //增量更新
  if (type === 'time' && startDate) {
    if (!filters) {
      filters = {};
    }
    if (!filters[x]) {
      filters[x] = {};
    }
    filters[x].$gte = startDate;

    await ChartData.remove({ source: chartSource._id }).where(x).gte(startDate);
  } else {
    await ChartData.remove({ source: chartSource._id });
  }
  let Model = service.model(model);
  let count = await Model.where(filters).count();

  if (!count) return;

  const reducers = service.config('reducers') || {};
  let custom = reducers[reducer];

  if (custom) {
    await buildCustomData(chartSource, Model, filters, custom);
    return;
  }

  if (type === 'time') {
    //按时间线统计
    await buildTimeData(chartSource, Model, filters);
  } else if (type === 'enum') {
    await buildEnumData(chartSource, Model, filters);
  } else if (type === 'cycle') {
    await buildCycleData(chartSource, Model, filters);
  } else {
    service.error('Unknown chart source type');
  }
}

export default class BuildData extends alaska.Sled {

  async exec(data) {
    const { chartSource, chart, startDate } = data;
    if (chartSource) return await buildChartSource(chartSource, startDate);

    if (chart) {
      let sources = await ChartSource.find().where('_id').in(chart.sources);
      for (let source of sources) {
        await buildChartSource(source, startDate);
      }
    }
  }

}
