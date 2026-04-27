export async function execute(params, context) {
  const timezone = params.timezone || 'Asia/Shanghai';
  const format = params.format || 'full';

  const now = new Date();

  const options = {};
  options.timeZone = timezone;

  let result = '';

  switch (format) {
    case 'full':
      options.year = 'numeric';
      options.month = 'long';
      options.day = 'numeric';
      options.weekday = 'long';
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.second = '2-digit';
      result = now.toLocaleString('zh-CN', options);
      break;

    case 'short':
      options.year = 'numeric';
      options.month = '2-digit';
      options.day = '2-digit';
      options.hour = '2-digit';
      options.minute = '2-digit';
      result = now.toLocaleString('zh-CN', options);
      break;

    case 'time':
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.second = '2-digit';
      result = now.toLocaleTimeString('zh-CN', options);
      break;

    case 'date':
      options.year = 'numeric';
      options.month = 'long';
      options.day = 'numeric';
      options.weekday = 'long';
      result = now.toLocaleDateString('zh-CN', options);
      break;

    default:
      options.year = 'numeric';
      options.month = 'long';
      options.day = 'numeric';
      options.weekday = 'long';
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.second = '2-digit';
      result = now.toLocaleString('zh-CN', options);
  }

  return result;
}
