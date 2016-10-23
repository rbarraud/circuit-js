import Signal, {halt} from './signal'

function idTest(v1, v2) {
  return v1 !== v2
}

export default function pure(sig) {
  var diff = typeof sig === 'function'? sig : idTest
  return {
    pure: function(sig, ctx, _diff) {
      diff = _diff || diff
      return sig.applyMW(function(next, v){
        if (diff(ctx.lv, v)) {
          var nv = next.apply(null, [].slice.call(arguments,1))
          if (!(nv instanceof halt)) {
            ctx.lv = v
          }
        }
      })
    }
  }
}
