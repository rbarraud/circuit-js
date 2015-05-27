  var mithrilCircus = (function(circus,mithril){

  'use strict';

  mithril = mithril || require('mithril')
	circus = circus || require('circus')

  // A simple adaptor that kick starts the application before
  // returning the rendered view wrapped in a mithril component.
  // Note that the application state can vary independently of
  // mithril redraw.
  var _stage = circus.stage
  circus.stage = function(m, v, i, s) {
    var app = _stage(m, v, i)

    return {
      // Opt-in mutable state. 
      // Mithril will only redraw guarded sections when their model
      // bindings are dirty 
      mutateOn: function(binding) {
        var args = [].slice.call(arguments,1)
        return app.model.dirty(binding)? mithril.apply(null,args) : {subtree:'retain'}
      },
  
      // project latest render into mithril component
      view: function() {
        var r = app.view.state()
        if (r === undefined) {
          m.head(s)
          r = app.view.state()
        }
        return r
      }
    }
  }

  return circus

})(circus,m)

if (typeof module != "undefined" && module !== null && module.exports) module.exports = mithrilCircus;
else if (typeof define == "function" && define.amd) define(function() {return mithrilCircus});