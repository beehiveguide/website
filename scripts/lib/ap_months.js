// AP Style Month Abbreviations
// March, April, May, June, July are not abbreviated per AP style.
const AP_MONTHS = {
  Jan: "Jan.",
  Feb: "Feb.",
  Mar: "March",
  Apr: "April",
  May: "May",
  Jun: "June",
  Jul: "July",
  Aug: "Aug.",
  Sep: "Sept.",
  Oct: "Oct.",
  Nov: "Nov.",
  Dec: "Dec.",
};

const formatApDate = (str) => {
  if (!str) return "";
  const [m, d] = str.split("-");
  const monthAbbr = m.slice(0, 3);
  const apMonth = AP_MONTHS[monthAbbr] || m;
  const day = Number(d);
  return `${apMonth} ${day}`;
};

module.exports = {
  AP_MONTHS,
  formatApDate,
};
